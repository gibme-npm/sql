// Copyright (c) 2023-2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { Client, Config as LibSQLConfig, createClient, InStatement, Transaction } from '@libsql/client';
import { resolve } from 'path';
import Database from './database';

export { Database };

export class LibSQL extends Database {
    private readonly database: Client;

    constructor (private readonly config: Partial<LibSQL.Config> = {}) {
        super(Database.Type.LIBSQL);

        if (!this.config.url) {
            throw new Error('Must specify database filename or URL');
        }

        // makes sure that the url is an absolute path
        if (this.config.url.startsWith('file:')) {
            const path = resolve(process.cwd(), this.config.url.slice(5));

            this.config.url = `file:${path}`;
        }

        this.database = createClient(this.config as LibSQLConfig);
    }

    public static get type (): Database.Type {
        return Database.Type.LIBSQL;
    }

    /**
     * Returns if transactions are enabled
     */
    public get transactionsEnabled (): boolean {
        return !this.config.url?.startsWith('http');
    }

    /**
     * Closes the database
     */
    public async close (): Promise<void> {
        return this.database.close();
    }

    /**
     * Creates a new instance connected to the specified database using
     * the same configuration options
     *
     * @param path
     */
    public async use (path: string): Promise<LibSQL> {
        return new LibSQL({
            ...this.config,
            url: path as any
        });
    }

    /**
     * Lists the tables in the specified database
     *
     * @param path
     */
    public async listTables (
        path?: string
    ): Promise<string[]> {
        const instance = path && path !== this.config.url ? await this.use(path) : this;

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
        query: string | LibSQL.Query,
        ...values: any[]
    ): Promise<LibSQL.Query.Result<RecordType>> {
        if (typeof query === 'object') {
            if (query.values) {
                values = query.values;
            }

            query = query.query;
        }

        const resultset = await this.database.execute({
            sql: query,
            args: values
        });

        const isQuery = query.toLowerCase().startsWith('select');

        return [
            isQuery ? resultset.rows as any[] : [],
            {
                changedRows: isQuery ? 0 : resultset.rowsAffected,
                affectedRows: isQuery ? 0 : resultset.rowsAffected,
                length: isQuery ? resultset.rows.length : 0
            },
            {
                query,
                values
            }
        ];
    }

    /**
     * Executes a low-level transaction call against the SQLite database connection
     *
     * Note: if connected to the database over HTTP/s, transactions will be batched instead
     *
     * @param queries
     * @protected
     */
    public async transaction<RecordType = any> (
        queries: LibSQL.Query[]
    ): Promise<LibSQL.Query.Result<RecordType>[]> {
        const results: LibSQL.Query.Result<RecordType>[] = [];

        if (this.transactionsEnabled) {
            const connection = await this.beginTransaction();

            try {
                for (const query of queries) {
                    try {
                        const result_set = await connection.execute(this.toInStmt(query));

                        results.push([
                            result_set.rows as any[],
                            {
                                changedRows: result_set.rowsAffected,
                                affectedRows: result_set.rowsAffected,
                                length: result_set.rows.length
                            },
                            query
                        ]);
                    } catch (error: any) {
                        if (!query.noError) {
                            throw this.make_error(error);
                        }
                    }
                }

                await this.commitTransaction(connection);

                return results;
            } catch (error: any) {
                await this.rollbackTransaction(connection);

                throw error;
            }
        } else {
            const resultset = await this.database.batch(
                queries.map(query => this.toInStmt(query))
            );

            for (let i = 0; i < resultset.length; i++) {
                const result = resultset[i];

                results.push([
                    result.rows as any[],
                    {
                        changedRows: result.rowsAffected,
                        affectedRows: result.rowsAffected,
                        length: result.rows.length
                    },
                    queries[i]
                ]);
            }
        }

        return results;
    }

    /**
     * Starts a new transaction
     *
     * @protected
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected async beginTransaction (): Promise<Transaction> {
        return this.database.transaction();
    }

    /**
     * Commits the open transaction
     *
     * @param connection
     * @protected
     */
    protected async commitTransaction (connection: Transaction): Promise<void> {
        return connection.commit();
    }

    /**
     * Rolls back the open transaction
     *
     * @param connection
     * @protected
     */
    protected async rollbackTransaction (connection: Transaction): Promise<void> {
        return connection.rollback();
    }

    /**
     * This is not required for this database type
     *
     * @protected
     */
    protected connection (): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Converts a Query to an InStatement
     *
     * @param query
     * @private
     */
    private toInStmt (query: LibSQL.Query): InStatement {
        return {
            sql: query.query,
            args: query.values ?? []
        };
    }
}

export namespace LibSQL {
    export type Path = `file:${string}` | `ws://${string}` | `wss://${string}` |
        `http://${string}` | `https://${string}` | `libsql://${string}`;

    export type Config = LibSQLConfig & { url: Path };

    export type Query = Database.Query;

    export namespace Query {
        export type Result<Type = any> = Database.Query.Result<Type>;
    }
}

export default LibSQL;
