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

import { createPool, Pool, PoolConfig, PoolConnection } from 'mysql';
import { Column, DatabaseType, ForeignKey, ForeignKeyConstraint, Query, QueryMetaData, QueryResult } from './types';
import Database from './database';

export { PoolConfig };
export { Column, ForeignKey, ForeignKeyConstraint, Query, QueryResult, QueryMetaData };

export default class MySQL extends Database {
    public readonly pool: Pool;

    /**
     * Creates a new instance of the class
     *
     * @param config
     */
    constructor (public readonly config: PoolConfig & { rejectUnauthorized?: boolean } = {}) {
        super(DatabaseType.MYSQL, 'ENGINE=InnoDB PACK_KEYS=1 ROW_FORMAT=COMPRESSED');

        this.config.host ??= '127.0.0.1';
        this.config.port ??= 3306;
        this.config.user ??= '';
        this.config.connectTimeout ??= 30_000;
        this.config.rejectUnauthorized ??= false;
        this.config.ssl ||= {
            rejectUnauthorized: this.config.rejectUnauthorized
        };

        this.pool = createPool(this.config);

        this.pool.on('error', error => this.emit('error', error));
        this.pool.on('acquire', connection => this.emit('acquire', connection));
        this.pool.on('connection', connection => this.emit('connection', connection));
        this.pool.on('enqueue', () => this.emit('enqueue'));
        this.pool.on('release', connection => this.emit('release', connection));
    }

    public static get type (): DatabaseType {
        return DatabaseType.MYSQL;
    }

    public on(event: 'error', listener: (error: Error) => void): this;

    public on(event: 'acquire', listener: (connection: PoolConnection) => void): this;

    public on(event: 'connection', listener: (connection: PoolConnection) => void): this;

    public on(event: 'enqueue', listener: () => void): this;

    public on(event: 'release', listener: (connection: PoolConnection) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Closes all the pooled connections
     */
    public async close (): Promise<void> {
        return new Promise((resolve, reject) => {
            this.pool.end(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    /**
     * Switches the default database referenced by the connection
     *
     * @param database
     */
    public async use (database: string): Promise<MySQL> {
        await this.query(`USE ${this.escapeId(database)}`);

        this.config.database = database;

        return this;
    }

    /**
     * Lists the tables in the specified database
     *
     * @param database
     */
    public async listTables (
        database = this.config.database
    ): Promise<string[]> {
        if (!database) {
            throw new Error('No database specified');
        }

        const [rows] = await this.query(`SHOW TABLES FROM ${this.escapeId(database)}`);

        return rows.map(row => {
            const key = Object.keys(row)[0];

            return row[key];
        });
    }

    /**
     * Performs an individual query and returns the result
     *
     * @param query
     * @param values
     * @param connection
     */
    public async query<RecordType = any> (
        query: string | Query,
        values: any[] = [],
        connection: Pool | PoolConnection = this.pool
    ): Promise<QueryResult<RecordType>> {
        return new Promise((resolve, reject) => {
            if (typeof query === 'object') {
                if (query.values) {
                    values = query.values;
                }

                query = query.query;
            }

            connection.query(query, values, (error, results) => {
                if (error) {
                    return reject(error);
                }

                return resolve([results, {
                    changedRows: results.changedRows || 0,
                    affectedRows: results.affectedRows || 0,
                    insertId: results.insertId || undefined,
                    length: results.length || 0
                }, {
                    query: query as string,
                    values
                }]);
            });
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
        const connection = await this.connection();

        try {
            await this.beginTransaction(connection);

            const results: QueryResult<RecordType>[] = [];

            for (const query of queries) {
                results.push(await this.query(query.query, query.values, connection));
            }

            await this.commitTransaction(connection);

            return results;
        } catch (error: any) {
            await this.rollbackTransaction(connection);

            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Returns a database connection from the pool
     *
     * @protected
     */
    protected async connection (): Promise<PoolConnection> {
        return new Promise((resolve, reject) => {
            this.pool.getConnection((error, connection) => {
                if (error) {
                    return reject(error);
                }

                return resolve(connection);
            });
        });
    }

    /**
     * Starts a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async beginTransaction (connection: PoolConnection): Promise<void> {
        return new Promise((resolve, reject) => {
            connection.beginTransaction(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    /**
     * Commits a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async commitTransaction (connection: PoolConnection): Promise<void> {
        return new Promise((resolve, reject) => {
            connection.commit(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    /**
     * Rolls back a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async rollbackTransaction (connection: PoolConnection): Promise<void> {
        return new Promise((resolve, reject) => {
            connection.rollback(error => {
                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }
}

export { MySQL };
