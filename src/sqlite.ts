// Copyright (c) 2016-2023, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import sqlite3 from 'sqlite3';
import { EventEmitter } from 'events';
import {
    Column,
    Database,
    DatabaseType,
    ForeignKey,
    ForeignKeyConstraint,
    Query,
    QueryMetaData,
    QueryResult,
    QueueEntryType,
    QueueEntry
} from './types';
import { prepareCreateTable, prepareMultiInsert, prepareMultiUpdate } from './common';
import { escape, escapeId } from 'mysql';
import { resolve } from 'path';
import { DatabaseOpenMode, getConnection, OpenMode, SQLiteDatabase } from './sqlite_instance';

export { Column, ForeignKey, ForeignKeyConstraint, Query, QueryResult, QueryMetaData };
export { escape, escapeId, OpenMode, DatabaseOpenMode };

/** @ignore */
const pragmaFunctionCalls = [
    'quick_check',
    'integrity_check',
    'incremental_vacuum',
    'foreign_key_check',
    'foreign_key_list',
    'index_info',
    'index_list',
    'index_xinfo',
    'table_info',
    'table_xinfo',
    'optimize'
];

export interface DatabaseConfig {
    filename: ':memory:' | string;
    mode: OpenMode;
    foreignKeys: boolean;
    WALmode: boolean;
    queueScanInterval: number;
}

/** @ignore */
const sleep = async (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout));

export default class SQLite extends EventEmitter implements Database {
    public tableOptions = '';
    public readonly config: DatabaseConfig = {
        filename: ':memory:',
        mode: DatabaseOpenMode.READWRITE | DatabaseOpenMode.CREATE,
        foreignKeys: true,
        WALmode: true,
        queueScanInterval: 10
    };

    private _statementQueue: QueueEntry[] = [];
    private _stopping = false;

    private database?: SQLiteDatabase;

    /**
     * Creates a new instance of the class
     *
     * @param config
     */
    constructor (
        config: Partial<DatabaseConfig> = {}
    ) {
        super();

        this.config.filename = config.filename || ':memory:';
        this.config.mode = config.mode || DatabaseOpenMode.READWRITE |
            DatabaseOpenMode.CREATE |
            DatabaseOpenMode.FULL_MUTEX;
        this.config.foreignKeys = config.foreignKeys ??= true;
        this.config.WALmode = config.WALmode ??= true;
        this.config.queueScanInterval = config.queueScanInterval ??= 10;

        if (this.config.filename.toLowerCase() === ':memory:') {
            this.config.mode |= DatabaseOpenMode.MEMORY;
        } else {
            this.config.filename = resolve(this.config.filename);
        }

        /**
         * This implements a queuing system inside this module to try to help
         * to prevent data race conditions whereby a write request may not fully
         * commit to the underlying database before a read request comes looking for it
         */
        (async () => {
            while (!this._stopping) {
                while (this._statementQueue.length > 0) {
                    const entry = this._statementQueue.shift();

                    if (!entry) {
                        break;
                    }

                    try {
                        switch (entry.type) {
                            case QueueEntryType.TRANSACTION: {
                                if (!entry.queries) {
                                    break;
                                }

                                const results = await this._transaction(entry.queries);

                                entry.callback(undefined, results);

                                break;
                            }
                            case QueueEntryType.ALL: {
                                if (!entry.query || !entry.values) {
                                    break;
                                }

                                const result = await this.all(entry.query, entry.values);

                                entry.callback(undefined, [result]);

                                break;
                            }
                            case QueueEntryType.RUN: {
                                if (!entry.query || !entry.values) {
                                    break;
                                }

                                const result = await this.run(entry.query, entry.values);

                                entry.callback(undefined, [result]);

                                break;
                            }
                        }
                    } catch (error: any) {
                        entry.callback(error);
                    }
                }

                await sleep(this.config.queueScanInterval);
            }
        })();
    }

    /**
     * Returns the current statement queue length
     */
    public get queueLength (): number {
        return this._statementQueue.length;
    }

    /**
     * Sets the execution mode to verbose and produces long stack traces.
     * There is no way to reset this. See the wiki page on debugging SQLite for more information.
     */
    public static verbose () {
        return sqlite3.verbose();
    }

    /**
     * Escapes the ID value
     *
     * @param id
     */
    public static escapeId (id: string): string {
        return escapeId(id);
    }

    /**
     * Escapes the value
     *
     * @param value
     */
    public static escape (value: string): string {
        return escape(value);
    }

    /**
     * Escapes the ID value
     *
     * @param id
     */
    public escapeId (id: string): string {
        return SQLite.escapeId(id);
    }

    /**
     * Escapes the value
     *
     * @param value
     */
    public escape (value: string): string {
        return SQLite.escape(value);
    }

    public on(event: 'error', listener: (error: Error) => void): this;

    public on(event: 'trace', listener: (sql: string) => void): this;

    public on(event: 'profile', listener: (sql: string, time: number) => void): this;

    public on(event: 'change', listener: (type: string, database: string, table: string, rowid: number) => void): this;

    public on(event: 'open', listener: () => void): this;

    public on(event: 'close', listener: () => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Closes the database
     */
    public async close (): Promise<void> {
        this._stopping = true;

        /**
         *  Don't close hte database connection while there is still
         *  stuff waiting to get done
         */
        while (this._statementQueue.length !== 0) {
            await sleep(this.config.queueScanInterval);
        }

        return new Promise((resolve, reject) => {
            if (!this.database) {
                return resolve();
            }

            this.database.close(error => {
                if (error) {
                    return reject(error);
                }

                delete this.database;

                return resolve();
            });
        });
    }

    /**
     * Prepares and executes the creation of a table including the relevant indexes and
     * constraints (are not supported)
     *
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     * @param useTransaction
     */
    public async createTable (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions = this.tableOptions,
        useTransaction = true
    ): Promise<void> {
        const queries = this.prepareCreateTable(name, fields, primaryKey, tableOptions);

        if (useTransaction) {
            await this.transaction(queries);
        } else {
            for (const query of queries) {
                await this.query(query);
            }
        }
    }

    /**
     * Creates a new instance connected to the specified database using
     * the same configuration options
     *
     * @param filename
     */
    public async use (filename: string): Promise<SQLite> {
        return new SQLite({
            ...this.config,
            filename
        });
    }

    /**
     * Retrieves the current PRAGMA setting
     * @param option
     */
    public async getPragma (option: string): Promise<unknown> {
        option = option.toLowerCase();

        /**
         * Execute this call via the low-level calling system outside the normal
         * queuing provided so that we do not mistakenly block the connection
         */
        const [rows] = await this.all<{ [key: string]: unknown }>(`PRAGMA ${option}`);

        if (rows.length === 1) {
            return rows[0][option];
        } else {
            if (rows[0][option]) {
                return rows.map(elem => elem[option]);
            }
        }

        return rows;
    }

    /**
     * Sets the given PRAGMA setting
     * @param option
     * @param value
     */
    public async setPragma (
        option: string,
        value: boolean | number | string
    ): Promise<void> {
        option = option.toLowerCase();
        value = pragmaFunctionCalls.includes(option) ? `(${value})` : ` = ${value}`;

        /**
         * Execute this call via the low-level calling system outside the normal
         * queuing provided so that we do not mistakenly block the connection
         */
        await this.run(`PRAGMA ${option}${value}`);
    }

    /**
     * Lists the tables in the specified database
     *
     * @param filename
     */
    public async listTables (
        filename?: string
    ): Promise<string[]> {
        const instance = filename && filename !== this.config.filename ? await this.use(filename) : this;

        const [rows] = await instance.query<{ name: string }>(
            'SELECT name FROM sqlite_schema WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\''
        );

        return rows.map(row => row.name);
    }

    /**
     * Drop the tables from the database
     *
     * @param tables
     */
    public async dropTable (tables: string | string[]): Promise<QueryResult[]> {
        if (!Array.isArray(tables)) {
            tables = [tables];
        }

        const queries: Query[] = [];

        for (const table of tables) {
            queries.push({
                query: `DROP TABLE IF EXISTS ${escapeId(table)}`
            });
        }

        return this.transaction(queries);
    }

    /**
     * Performs an individual query and returns the result
     *
     * @param query
     * @param values
     */
    public async query<RecordType = any> (
        query: string | Query,
        values: any[] = []
    ): Promise<QueryResult<RecordType>> {
        return new Promise((resolve, reject) => {
            if (typeof query === 'object') {
                if (query.values) {
                    values = query.values;
                }

                query = query.query;
            }

            if (query.toLowerCase().startsWith('select')) {
                this._statementQueue.push({
                    query,
                    values,
                    type: QueueEntryType.ALL,
                    callback: (error: Error | undefined, results) => {
                        if (error) {
                            return reject(error);
                        }

                        if (!results || results.length !== 1) {
                            return reject(new Error('Malformed result received'));
                        }

                        return resolve(results[0]);
                    }
                });
            } else {
                this._statementQueue.push({
                    query,
                    values,
                    type: QueueEntryType.RUN,
                    callback: (error: Error | undefined, results) => {
                        if (error) {
                            return reject(error);
                        }

                        if (!results || results.length !== 1) {
                            return reject(new Error('Malformed result received'));
                        }

                        return resolve(results[0]);
                    }
                });
            }
        });
    }

    /**
     * Prepares and performs a query that performs a multi-insert statement
     * which is far faster than a bunch of individual insert statements
     *
     * @param table
     * @param columns
     * @param values
     * @param useTransaction
     */
    public async multiInsert (
        table: string,
        columns: string[] = [],
        values: any[][],
        useTransaction = true
    ): Promise<QueryResult> {
        const queries = this.prepareMultiInsert(table, columns, values);

        if (useTransaction) {
            const results = await this.transaction(queries);

            return [
                [],
                {
                    affectedRows: results.map(result => result[1].affectedRows)
                        .reduce((previous, current) => previous + current),
                    changedRows: results.map(result => result[1].changedRows)
                        .reduce((previous, current) => previous + current),
                    length: results.map(result => result[1].length)
                        .reduce((previous, current) => previous + current)
                },
                {
                    query: queries.map(query => query.query).join(';')
                }
            ];
        } else {
            let affectedRows = 0;
            let changedRows = 0;
            let length = 0;

            for (const query of queries) {
                const [, meta] = await this.query(query);

                affectedRows += meta.affectedRows;
                changedRows += meta.changedRows;
                length += meta.length;
            }

            return [
                [],
                {
                    affectedRows,
                    changedRows,
                    length
                }, {
                    query: queries.map(query => query.query).join(';')
                }
            ];
        }
    }

    /**
     * Prepares and executes a query to that performs  a multi-update statement
     * which is based upon a multi-insert statement that performs an UPSERT
     * which is a lot faster than a bunch of update statements
     *
     * @param table
     * @param primaryKey
     * @param columns
     * @param values
     * @param useTransaction
     */
    public async multiUpdate (
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][],
        useTransaction = true
    ): Promise<QueryResult> {
        const queries = this.prepareMultiUpdate(table, primaryKey, columns, values);

        if (useTransaction) {
            const results = await this.transaction(queries);

            return [
                [],
                {
                    affectedRows: results.map(result => result[1].affectedRows)
                        .reduce((previous, current) => previous + current),
                    changedRows: results.map(result => result[1].changedRows)
                        .reduce((previous, current) => previous + current),
                    length: results.map(result => result[1].length)
                        .reduce((previous, current) => previous + current)
                },
                {
                    query: queries.map(query => query.query).join(';')
                }
            ];
        } else {
            let affectedRows = 0;
            let changedRows = 0;
            let length = 0;

            for (const query of queries) {
                const [, meta] = await this.query(query);

                affectedRows += meta.affectedRows;
                changedRows += meta.changedRows;
                length += meta.length;
            }

            return [
                [],
                {
                    affectedRows,
                    changedRows,
                    length
                }, {
                    query: queries.map(query => query.query).join(';')
                }
            ];
        }
    }

    /**
     * Performs the specified queries in a transaction
     *
     * @param queries
     */
    public async transaction<RecordType = any> (
        queries: Query[]
    ): Promise<QueryResult<RecordType>[]> {
        return new Promise((resolve, reject) => {
            this._statementQueue.push({
                queries,
                type: QueueEntryType.TRANSACTION,
                callback: (error: Error | undefined, result) => {
                    if (error) {
                        return reject(error);
                    }

                    if (!result) {
                        return reject(new Error('Malformed result received'));
                    }

                    return resolve(result);
                }
            });
        });
    }

    /**
     * Prepares a query to perform a multi-insert statement which is far
     * faster than a bunch of individual insert statements
     *
     * @param table
     * @param columns
     * @param values
     */
    public prepareMultiInsert (
        table: string,
        columns: string[] = [],
        values: any[][]
    ): Query[] {
        return prepareMultiInsert(DatabaseType.SQLITE, table, columns, values, escapeId);
    }

    /**
     * Prepares a query to perform a multi-update statement which is
     * based upon a multi-insert statement that performs an UPSERT
     * and this is a lot faster than a bunch of individual
     * update statements
     *
     * @param table
     * @param primaryKey
     * @param columns
     * @param values
     */
    public prepareMultiUpdate (
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][]
    ): Query[] {
        return prepareMultiUpdate(DatabaseType.SQLITE, table, primaryKey, columns, values, escapeId);
    }

    /**
     * Prepares the creation of a table including the relevant indexes and constraints
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     */
    public prepareCreateTable (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions = this.tableOptions
    ): Query[] {
        return prepareCreateTable(name, fields, primaryKey, tableOptions, escapeId);
    }

    /**
     * Executes a low-level transaction call against the SQLite database connection
     *
     * @param queries
     * @protected
     */
    protected async _transaction<RecordType = any> (
        queries: Query[]
    ): Promise<QueryResult<RecordType>[]> {
        const connection = await this.connection();

        try {
            await connection.run('BEGIN');

            const results: QueryResult<RecordType>[] = [];

            for (const query of queries) {
                if (query.query.toLowerCase().startsWith('select')) {
                    results.push(await this.all(query.query, query.values, connection));
                } else {
                    results.push(await this.run(query.query, query.values, connection));
                }
            }

            await connection.run('COMMIT');

            return results;
        } catch (error: any) {
            await connection.run('ROLLBACK');

            throw error;
        }
    }

    /**
     * Executes a low-level all call against the SQLite database connection
     *
     * @param query
     * @param values
     * @param connection
     * @protected
     */
    protected async all<RecordType = any> (
        query: string,
        values: any[] = [],
        connection?: SQLiteDatabase
    ): Promise<QueryResult<RecordType>> {
        connection ||= await this.connection();

        return new Promise((resolve, reject) => {
            connection?.all(query, values, function (error: Error | null, rows: any[]) {
                if (error) {
                    return reject(error);
                }

                return resolve([
                    rows,
                    {
                        changedRows: 0,
                        affectedRows: 0,
                        length: rows.length
                    },
                    {
                        query: query as string,
                        values
                    }
                ]);
            });
        });
    }

    /**
     * Executes a low-level run call against the SQLite database connection
     *
     * @param query
     * @param values
     * @param connection
     * @protected
     */
    protected async run<RecordType = any> (
        query: string,
        values: any[] = [],
        connection?: SQLiteDatabase
    ): Promise<QueryResult<RecordType>> {
        connection ||= await this.connection();

        return new Promise((resolve, reject) => {
            connection?.run(query, values, function (error: Error | null) {
                if (error) {
                    return reject(error);
                }

                return resolve([
                    [],
                    {
                        changedRows: this.changes || 0,
                        affectedRows: this.changes || 0,
                        insertId: this.lastID || 0,
                        length: 0
                    },
                    {
                        query: query as string,
                        values
                    }
                ]);
            });
        });
    }

    /**
     * Returns a database connection to the underlying SQLite database
     *
     * @protected
     */
    protected async connection (): Promise<SQLiteDatabase> {
        if (this.database) {
            return this.database;
        }

        this.database = await getConnection(this.config.filename, this.config.mode);

        this.database.on('error', error => this.emit('error', error));
        this.database.on('trace', sql => this.emit('trace', sql));
        this.database.on('profile', (sql, time) =>
            this.emit('trace', sql, time));
        this.database.on('change', (type, database, table, rowid) =>
            this.emit('change', type, database, table, rowid));
        this.database.on('open', () => this.emit('open'));
        this.database.on('close', () => this.emit('close'));

        if (this.config.WALmode) {
            await this.setPragma('journal_mode', 'WAL');
        }

        if (this.config.foreignKeys) {
            await this.setPragma('foreign_keys', true);
        }

        return this.database;
    }
}

export { SQLite };
