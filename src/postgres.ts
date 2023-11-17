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

import { Column, DatabaseType, ForeignKey, ForeignKeyConstraint, Query, QueryMetaData, QueryResult } from './types';
import { Pool, PoolClient, PoolConfig } from 'pg';
import Database, { IDatabase } from './database';

export { PoolConfig };
export { QueryMetaData, Query, QueryResult, ForeignKey, ForeignKeyConstraint, Column, IDatabase };

export default class Postgres extends Database {
    public readonly pool: Pool;

    /**
     * Creates a new instance of the class
     *
     * @param config
     */
    constructor (public readonly config: PoolConfig & { rejectUnauthorized?: boolean } = {}) {
        super(DatabaseType.POSTGRES);

        this.config.host ??= '127.0.0.1';
        this.config.port ??= 5432;
        this.config.user ??= '';
        this.config.rejectUnauthorized ??= false;
        this.config.ssl ??= {
            rejectUnauthorized: this.config.rejectUnauthorized
        };
        this.pool = new Pool(this.config);

        this.pool.on('connect', client => this.emit('connect', client));
        this.pool.on('acquire', client => this.emit('acquire', client));
        this.pool.on('remove', client => this.emit('remove', client));
        this.pool.on('error', (error: Error, client: PoolClient) =>
            this.emit('error', error, client));
    }

    public static get type (): DatabaseType {
        return DatabaseType.POSTGRES;
    }

    public on(event: 'connect', listener: (client: PoolClient) => void): this;

    public on(event: 'acquire', listener: (client: PoolClient) => void): this;

    public on(event: 'remove', listener: (client: PoolClient) => void): this;

    public on(event: 'error', listener: (error: Error, client: PoolClient) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Closes all pooled connections
     */
    public async close (): Promise<void> {
        return this.pool.end();
    }

    /**
     * Creates a new instance connected to the specified database using
     * the same configuration options
     *
     * @param database
     * @param user
     * @param password
     */
    public async use (
        database: string,
        user?: string,
        password?: string
    ): Promise<Postgres> {
        return new Postgres({
            ...this.config,
            database,
            user: user || this.config.user,
            password: password || this.config.password
        });
    }

    /**
     * Lists the tables in the current schema
     */
    public async listTables (
        database = this.config.database
    ): Promise<string[]> {
        if (!database) {
            throw new Error('No database specified');
        }

        const instance = database !== this.config.database ? await this.use(database) : this;

        const [rows] = await instance.query<{ tablename: string }>(
            'SELECT tablename FROM pg_catalog.pg_tables ' +
            'WHERE schemaname != \'pg_catalog\' AND schemaname != \'information_schema\' ' +
            'ORDER BY tablename');

        return rows.map(row => row.tablename);
    }

    /**
     * Performs an individual query and returns the results
     *
     * @param query
     * @param values
     */
    public async query<RecordType = any> (
        query: string | Query,
        ...values: any[]
    ): Promise<QueryResult<RecordType>> {
        return this._query(query, values);
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
                try {
                    results.push(await this._query(query.query, query.values, connection));
                } catch (error: any) {
                    if (!query.noError) {
                        throw new Error(error);
                    }
                }
            }

            await this.commitTransaction(connection);

            return results;
        } catch (error: any) {
            await this.rollbackTransaction(connection);

            throw error;
        } finally {
            await this.release(connection);
        }
    }

    /**
     * Returns a database connection from the pool
     *
     * @protected
     */
    protected async connection (): Promise<PoolClient> {
        return this.pool.connect();
    }

    /**
     * Starts a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async beginTransaction (connection: PoolClient): Promise<void> {
        await connection.query('BEGIN');
    }

    /**
     * Commits a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async commitTransaction (connection: PoolClient): Promise<void> {
        await connection.query('COMMIT');
    }

    /**
     * Rolls back a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async rollbackTransaction (connection: PoolClient): Promise<void> {
        await connection.query('ROLLBACK');
    }

    /**
     * Transforms a query from using ?-based placeholders to pgsql placeholders
     *
     * @param query
     * @protected
     */
    protected transformQuery (query: string): string {
        let counter = 1;

        while (query.includes('?')) {
            query = query.replace(/\?/, `$${counter++}`);
        }

        return query;
    }

    /**
     * Assists with releasing connections once we are done with them
     *
     * @param connection
     * @protected
     */
    protected async release (connection: PoolClient): Promise<void> {
        try {
            connection.release(false);
        } catch (error: any) {
            if (!error.toString()
                .toLowerCase()
                .includes('already been released')) {
                throw new Error(error);
            }
        }
    }

    /**
     * Performs an individual query and returns the results
     *
     * @param query
     * @param values
     * @param connection
     */
    private async _query<RecordType = any> (
        query: string | Query,
        values: any[] = [],
        connection: Pool | PoolClient = this.pool
    ): Promise<QueryResult<RecordType>> {
        if (typeof query === 'object') {
            if (query.values) {
                values = query.values;
            }

            query = query.query;
        }

        query = this.transformQuery(query);

        const result = await connection.query(query, values);

        if (!(connection instanceof Pool)) {
            connection.release();
        }

        return [result.rows, {
            changedRows: result.rows.length === 0 ? result.rowCount || 0 : 0,
            affectedRows: result.rows.length === 0 ? result.rowCount || 0 : 0,
            length: result.rows.length
        }, {
            query,
            values
        }];
    }
}

export { Postgres };
