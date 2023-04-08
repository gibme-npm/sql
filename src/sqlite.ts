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
import { Column, DatabaseType, ForeignKey, ForeignKeyConstraint, Query, QueryMetaData, QueryResult } from './types';
import { resolve } from 'path';
import SQLiteInstanceManager, { DatabaseOpenMode, OpenMode, SQLiteInstance } from './sqlite_instance_manager';
import Database from './database';

export { Column, ForeignKey, ForeignKeyConstraint, Query, QueryResult, QueryMetaData };
export { OpenMode, DatabaseOpenMode };

export interface DatabaseConfig {
    filename: ':memory:' | string;
    mode: OpenMode;
    foreignKeys: boolean;
    WALmode: boolean;
    queueScanInterval: number;
}

export default class SQLite extends Database {
    public readonly config: DatabaseConfig = {
        filename: ':memory:',
        mode: DatabaseOpenMode.READWRITE | DatabaseOpenMode.CREATE,
        foreignKeys: true,
        WALmode: true,
        queueScanInterval: 10
    };

    private database?: SQLiteInstance;

    /**
     * Creates a new instance of the class
     *
     * @param config
     */
    constructor (
        config: Partial<DatabaseConfig> = {}
    ) {
        super(DatabaseType.SQLITE);

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
    }

    public static get type (): DatabaseType {
        return DatabaseType.SQLITE;
    }

    /**
     * Sets the execution mode to verbose and produces long stack traces.
     * There is no way to reset this. See the wiki page on debugging SQLite for more information.
     */
    public static verbose () {
        return sqlite3.verbose();
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
     * Closes the database instance
     *
     * Note: closing the db using this method will kill the instance
     * for all references to the instance
     */
    public async close (): Promise<void> {
        const instance = await this.getInstance();

        return instance.close();
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
        const instance = await this.getInstance();

        return instance.getPragma(option);
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
        const instance = await this.getInstance();

        return instance.setPragma(option, value);
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
     * Performs an individual query and returns the result
     *
     * @param query
     * @param values
     */
    public async query<RecordType = any> (
        query: string | Query,
        ...values: any[]
    ): Promise<QueryResult<RecordType>> {
        const instance = await this.getInstance();

        return instance.query<RecordType>(query, ...values);
    }

    /**
     * Performs the specified queries in a transaction
     *
     * @param queries
     */
    public async transaction<RecordType = any> (
        queries: Query[]
    ): Promise<QueryResult<RecordType>[]> {
        const instance = await this.getInstance();

        return instance.transaction<RecordType>(queries);
    }

    /**
     * Retrieves the SQLite database instance singleton
     *
     * @private
     */
    private async getInstance (): Promise<SQLiteInstance> {
        if (this.database) {
            return this.database;
        }

        this.database = await SQLiteInstanceManager.get(
            this.config.filename, this.config.mode, this.config.queueScanInterval);

        this.database.on('error', error => this.emit('error', error));
        this.database.on('trace', sql => this.emit('trace', sql));
        this.database.on('profile', (sql, time) =>
            this.emit('trace', sql, time));
        this.database.on('change', (type, database, table, rowid) =>
            this.emit('change', type, database, table, rowid));
        this.database.on('open', () => this.emit('open'));
        this.database.on('close', () => this.emit('close'));

        if (this.config.WALmode) {
            await this.database.setPragma('journal_mode', 'WAL');
        }

        if (this.config.foreignKeys) {
            await this.database.setPragma('foreign_keys', true);
        }

        return this.database;
    }
}

export { SQLite };
