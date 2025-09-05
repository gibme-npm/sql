// Copyright (c) 2016-2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

import Sqlite3, { Database as SQLiteDatabase } from 'better-sqlite3';
import Database from './database';
import { Mutex } from 'async-mutex';

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

export class SQLiteInstance {
    private readonly mutex = new Mutex();

    // eslint-disable-next-line no-useless-constructor
    protected constructor (
        private readonly database: SQLiteDatabase
    ) {
    }

    /**
     * Returns if the database is currently open
     */
    public get open (): boolean {
        return this.database.open;
    }

    /**
     * Returns if the database is currently in a transaction
     */
    public get inTransaction (): boolean {
        return this.database.inTransaction;
    }

    /**
     * Returns the filename of the database
     */
    public get name (): string {
        return this.database.name;
    }

    /**
     * Returns whether this database is in-memory only
     */
    public get memory (): boolean {
        return this.database.memory;
    }

    /**
     * Returns whether this database is in readonly mode
     */
    public get readonly (): boolean {
        return this.database.readonly;
    }

    /**
     * Loads a new instance of an SQLite database or loads from memory if already opened
     *
     * @param filename
     * @param readonly
     */
    public static async load (
        filename: string,
        readonly = false
    ): Promise<SQLiteInstance> {
        const db = await SQLiteInstance.open(filename, readonly);

        return new SQLiteInstance(db);
    }

    /**
     * Opens a SQLite database
     *
     * @param filename
     * @param readonly
     * @private
     */
    private static async open (
        filename: string,
        readonly = false
    ): Promise<SQLiteDatabase> {
        return new Sqlite3(filename, { readonly });
    }

    /**
     * Closes the database
     */
    public async close (): Promise<void> {
        this.database.close();
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
        const [rows] = await this.allAsync<{ [key: string]: unknown }>({
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
        await this.runAsync({ query: `PRAGMA ${option}${value}` });
    }

    /**
     * Performs an individual query and returns the result
     *
     * @param query
     * @param values
     */
    public async query<RecordType = any> (
        query: string | Database.Query,
        ...values: any[]
    ): Promise<Database.Query.Result<RecordType>> {
        if (typeof query === 'object') {
            if (query.values) {
                values = query.values;
            }

            query = query.query;
        }

        if (query.toLowerCase().startsWith('select')) {
            return this.allAsync({
                query,
                values
            });
        } else {
            return this.runAsync({
                query,
                values
            });
        }
    }

    /**
     * Performs the specified queries in a transaction
     *
     * @param queries
     */
    public async transaction<RecordType = any> (
        queries: Database.Query[]
    ): Promise<Database.Query.Result<RecordType>[]> {
        return this._transaction(queries);
    }

    /**
     * Executes a low-level-all call against the SQLite database connection
     * that is wrapped in a mutex to prevent multiple queries from being
     * executed at the same time
     *
     * @param query
     * @private
     */
    private async allAsync<RecordType = any> (
        query: Database.Query
    ): Promise<Database.Query.Result<RecordType>> {
        return this.mutex.runExclusive(() => {
            return this.allSync(query);
        });
    }

    /**
     * Executes a low-level-all call against the SQLite database connection
     *
     * @param query
     * @private
     */
    private allSync<RecordType = any> (
        query: Database.Query
    ): Database.Query.Result<RecordType> {
        const stmt = this.database.prepare(query.query);

        const rows = stmt.all(...query.values ?? []) as RecordType[];

        return [
            rows,
            {
                changedRows: 0,
                affectedRows: 0,
                length: rows.length
            },
            query
        ];
    }

    /**
     * Executes a low-level run call against the SQLite database connection
     * that is wrapped in a mutex to prevent multiple queries from being
     * executed at the same time
     *
     * @param query
     * @private
     */
    private async runAsync<RecordType = any> (
        query: Database.Query
    ): Promise<Database.Query.Result<RecordType>> {
        return this.mutex.runExclusive(() => {
            return this.runSync(query);
        });
    }

    /**
     * Executes a low-level run call against the SQLite database connection
     *
     * @param query
     * @private
     */
    private runSync<RecordType = any> (
        query: Database.Query
    ): Database.Query.Result<RecordType> {
        const stmt = this.database.prepare(query.query);

        const info = stmt.run(...query.values ?? []);

        const insertId = parseInt(info.lastInsertRowid.toString() ?? '') || 0;

        return [
            [],
            {
                changedRows: info.changes ?? 0,
                affectedRows: info.changes ?? 0,
                insertId,
                length: 0
            },
            query
        ];
    }

    /**
     * Executes a low-level transaction call against the SQLite database connection
     *
     * @param queries
     * @protected
     */
    private async _transaction<RecordType = any> (
        queries: Database.Query[]
    ): Promise<Database.Query.Result<RecordType>[]> {
        return this.mutex.runExclusive(() => {
            const results: Database.Query.Result<RecordType>[] = [];

            const tx = this.database.transaction(() => {
                for (const query of queries) {
                    if (query.query.toLowerCase().startsWith('select')) {
                        results.push(this.allSync(query));
                    } else {
                        results.push(this.runSync(query));
                    }
                }
            });

            try {
                tx();
            } catch (error: any) {
                if (queries.some(q => !q.noError)) {
                    if (error instanceof Error) {
                        throw error;
                    }

                    throw new Error(error.toString());
                }
            }

            return results;
        });
    }
}
