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

import { EventEmitter } from 'events';
import {
    Column,
    Database,
    DatabaseType,
    ForeignKey,
    ForeignKeyConstraint,
    Query,
    QueryMetaData,
    QueryResult
} from './types';
import { Pool, PoolClient, PoolConfig } from 'pg';
import pgformat from 'pg-format';
import { prepareCreateTable, prepareMultiInsert, prepareMultiUpdate } from './common';

export { PoolConfig };
export { QueryMetaData, Query, QueryResult, ForeignKey, ForeignKeyConstraint, Column };

/** @ignore */
const escapeId = (id: string): string => pgformat('%I', id);

/** @ignore */
const escape = (value: string): string => pgformat('%L', value);

export { escapeId, escape };

export default class Postgres extends EventEmitter implements Database {
    public readonly pool: Pool;
    public tableOptions = '';

    /**
     * Creates a new instance of the class
     *
     * @param config
     */
    constructor (public readonly config: PoolConfig & { rejectUnauthorized?: boolean }) {
        super();

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
        return Postgres.escapeId(id);
    }

    /**
     * Escapes the value
     *
     * @param value
     */
    public escape (value: string): string {
        return Postgres.escape(value);
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
     * Prepares and executes the creation of a table including the relevant indexes and constraints
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
     * Performs an individual query and returns the results
     *
     * @param query
     * @param values
     * @param connection
     */
    public async query<RecordType = any> (
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
            await connection.release();
        }

        return [result.rows, {
            changedRows: result.rows.length === 0 ? result.rowCount : 0,
            affectedRows: result.rows.length === 0 ? result.rowCount : 0,
            length: result.rows.length
        }, {
            query,
            values
        }];
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
            await this.release(connection);
        }
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
        return prepareMultiInsert(DatabaseType.POSTGRES, table, columns, values, escapeId);
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
        return prepareMultiUpdate(DatabaseType.POSTGRES, table, primaryKey, columns, values, escapeId);
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
}

export { Postgres };
