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

import { Database } from 'sqlite3';
import { EventEmitter } from 'events';
import { make_error, Query, QueryResult } from './types';

export enum DatabaseOpenMode {
    READONLY = 0x00000001,
    READWRITE = 0x00000002,
    CREATE = 0x00000004,
    DELETEONCLOSE = 0x00000008,
    EXCLUSIVE = 0x00000010,
    AUTOPROXY = 0x00000020,
    URI = 0x00000040,
    MEMORY = 0x00000080,
    MAIN_DB = 0x00000100,
    TEMP_DB = 0x00000200,
    TRANSIENT_DB = 0x00000400,
    MAIN_JOURNAL = 0x00000800,
    TEMP_JOURNAL = 0x00001000,
    SUB_JOURNAL = 0x00002000,
    SUPER_JOURNAL = 0x00004000,
    NO_MUTEX = 0x00008000,
    FULL_MUTEX = 0x00010000,
    SHAREDCACHE = 0x00020000,
    PRIVATECACHE = 0x00040000,
    WAL = 0x00080000,
    NOFOLLOW = 0x01000000,
    EXRESCODE = 0x02000000
}

export type OpenMode = number;

export type SQLiteDatabase = Database;

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

/** @ignore */
const sleep = async (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout));

/** @ignore */
interface Callback<Type = any> {
    callback: (error: Error | undefined, results?: QueryResult<Type>[]) => void;
}

/** @ignore */
enum QueueEntryType {
    TRANSACTION,
    ALL,
    RUN
}

/** @ignore */
interface QueueEntry<Type = any> extends Callback<Type> {
    type: QueueEntryType;
    queries: Query[];
}

export default class SQLiteInstance extends EventEmitter {
    private statementQueue: QueueEntry[] = [];
    private stopping = false;

    protected constructor (
        public readonly id: string,
        private readonly database: SQLiteDatabase,
        private readonly queueScanInterval = 10
    ) {
        super();

        this.database.on('error', error => this.emit('error', error));
        this.database.on('trace', sql => this.emit('trace', sql));
        this.database.on('profile', (sql, time) =>
            this.emit('trace', sql, time));
        this.database.on('change', (type, database, table, rowid) =>
            this.emit('change', type, database, table, rowid));
        this.database.on('open', () => this.emit('open'));
        this.database.on('close', () => this.emit('close'));

        /**
         * This implements a queuing system inside this module to try to help
         * to prevent data race conditions whereby a write request may not fully
         * commit to the underlying database before a read request comes looking for it
         */
        (async () => {
            while (!this.stopping) {
                while (this.statementQueue.length > 0) {
                    const entry = this.statementQueue.shift();

                    if (!entry) {
                        break;
                    }

                    try {
                        switch (entry.type) {
                            case QueueEntryType.TRANSACTION: {
                                const results = await this._transaction(entry.queries);

                                entry.callback(undefined, results);

                                break;
                            }
                            case QueueEntryType.ALL: {
                                const result = await this._all(entry.queries[0]);

                                entry.callback(undefined, [result]);

                                break;
                            }
                            case QueueEntryType.RUN: {
                                const result = await this._run(entry.queries[0]);

                                entry.callback(undefined, [result]);

                                break;
                            }
                            default:
                                entry.callback(new Error('Unknown query entry type'), []);
                                break;
                        }
                    } catch (error: any) {
                        entry.callback(error);
                    }
                }

                await sleep(this.queueScanInterval);
            }
        })();
    }

    /**
     * Loads a new instance of a SQLite database or loads from memory if already opened
     *
     * @param id
     * @param filename
     * @param mode
     * @param queueScanInterval
     */
    public static async load (
        id: string,
        filename: string,
        mode: OpenMode = DatabaseOpenMode.CREATE | DatabaseOpenMode.READWRITE | DatabaseOpenMode.FULL_MUTEX,
        queueScanInterval = 10
    ): Promise<SQLiteInstance> {
        const db = await SQLiteInstance.open(filename, mode);

        return new SQLiteInstance(id, db, queueScanInterval);
    }

    /**
     * Opens a SQLite database
     *
     * @param filename
     * @param mode
     * @private
     */
    private static async open (
        filename: string,
        mode: OpenMode = DatabaseOpenMode.CREATE | DatabaseOpenMode.READWRITE | DatabaseOpenMode.FULL_MUTEX
    ): Promise<SQLiteDatabase> {
        return new Promise((resolve, reject) => {
            const database: SQLiteDatabase = new Database(filename, mode, error => {
                if (error) {
                    return reject(error);
                }

                return resolve(database);
            });
        });
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
        this.stopping = true;

        /**
         *  Don't close hte database connection while there is still
         *  stuff waiting to get done
         */
        while (this.statementQueue.length !== 0) {
            await sleep(this.queueScanInterval);
        }

        return new Promise((resolve, reject) => {
            if (!this.database) {
                return resolve();
            }

            this.database.close(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
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
        const [rows] = await this._all<{ [key: string]: unknown }>({
            query: `PRAGMA ${option}`
        });

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
        await this._run({ query: `PRAGMA ${option}${value}` });
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
        return new Promise((resolve, reject) => {
            if (typeof query === 'object') {
                if (query.values) {
                    values = query.values;
                }

                query = query.query;
            }

            if (query.toLowerCase().startsWith('select')) {
                this.statementQueue.push({
                    queries: [{
                        query,
                        values
                    }],
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
                this.statementQueue.push({
                    queries: [{
                        query,
                        values
                    }],
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
     * Performs the specified queries in a transaction
     *
     * @param queries
     */
    public async transaction<RecordType = any> (
        queries: Query[]
    ): Promise<QueryResult<RecordType>[]> {
        return new Promise((resolve, reject) => {
            this.statementQueue.push({
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
     * Executes a low-level all call against the SQLite database connection
     *
     * @param query
     * @protected
     */
    private async _all<RecordType = any> (
        query: Query
    ): Promise<QueryResult<RecordType>> {
        return new Promise((resolve, reject) => {
            this.database.all(query.query, query.values, function (error: Error | null, rows: any[]) {
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
                    query
                ]);
            });
        });
    }

    /**
     * Executes a low-level run call against the SQLite database connection
     *
     * @param query
     * @protected
     */
    private async _run<RecordType = any> (
        query: Query
    ): Promise<QueryResult<RecordType>> {
        return new Promise((resolve, reject) => {
            this.database.run(query.query, query.values, function (error: Error | null) {
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
                    query
                ]);
            });
        });
    }

    /**
     * Executes a low-level transaction call against the SQLite database connection
     *
     * @param queries
     * @protected
     */
    private async _transaction<RecordType = any> (
        queries: Query[]
    ): Promise<QueryResult<RecordType>[]> {
        try {
            await this.database.run('BEGIN');

            const results: QueryResult<RecordType>[] = [];

            for (const query of queries) {
                try {
                    if (query.query.toLowerCase().startsWith('select')) {
                        results.push(await this._all(query));
                    } else {
                        results.push(await this._run(query));
                    }
                } catch (error: any) {
                    if (!query.noError) {
                        throw make_error(error);
                    }
                }
            }

            await this.database.run('COMMIT');

            return results;
        } catch (error: any) {
            await this.database.run('ROLLBACK');

            throw error;
        }
    }
}
