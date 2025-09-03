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

import { createPool, Pool, PoolConfig as MySQLPoolConfig, PoolConnection } from 'mariadb';
import Database from './database';

export { Database };

type OkPacket = {
    affectedRows: number;
    insertId: number;
    changedRows?: number;
}

/** @ignore */
const isOkPacket = (x: unknown): x is OkPacket => {
    return !!x && typeof x === 'object' &&
        'affectedRows' in x &&
        'insertId' in x &&
        'warningStatus' in x;
};

export class MySQL extends Database {
    public readonly pool: Pool;

    /**
     * Creates a new instance of the class
     *
     * @param config
     * @param override_type
     */
    constructor (
        public readonly config: MySQL.Config = {},
        override_type: Database.Type.MYSQL | Database.Type.MARIADB = Database.Type.MYSQL
    ) {
        super(override_type, 'ENGINE=InnoDB PACK_KEYS=1 ROW_FORMAT=COMPRESSED');

        this.config.host ??= '127.0.0.1';
        this.config.port ??= 3306;
        this.config.user ??= '';
        this.config.connectTimeout ??= 30_000;
        this.config.useSSL ??= false;
        this.config.rejectUnauthorized ??= false;
        this.config.multipleStatements = false;

        if (this.config.useSSL) {
            this.config.ssl ||= {
                rejectUnauthorized: this.config.rejectUnauthorized
            };
        }

        this.pool = createPool(this.config);

        this.pool.on('acquire', connection => this.emit('acquire', connection));
        this.pool.on('connection', connection => this.emit('connection', connection));
        this.pool.on('enqueue', () => this.emit('enqueue'));
        this.pool.on('release', connection => this.emit('release', connection));
    }

    public static get type (): Database.Type {
        return Database.Type.MYSQL;
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
        return this.pool.end();
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
     */
    public async query<RecordType = any> (
        query: string | MySQL.Query,
        ...values: any[]
    ): Promise<MySQL.Query.Result<RecordType>> {
        return this._query(query, values);
    }

    /**
     * Performs the specified queries in a transaction
     *
     * @param queries
     */
    public async transaction<RecordType = any> (
        queries: MySQL.Query[]
    ): Promise<MySQL.Query.Result<RecordType>[]> {
        const connection = await this.connection();

        try {
            await this.beginTransaction(connection);

            const results: MySQL.Query.Result<RecordType>[] = [];

            for (const query of queries) {
                try {
                    results.push(await this._query(query.query, query.values, connection));
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
        return this.pool.getConnection();
    }

    /**
     * Starts a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async beginTransaction (connection: PoolConnection): Promise<void> {
        return connection.beginTransaction();
    }

    /**
     * Commits a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async commitTransaction (connection: PoolConnection): Promise<void> {
        return connection.commit();
    }

    /**
     * Rolls back a transaction on the specified connection
     *
     * @param connection
     * @protected
     */
    protected async rollbackTransaction (connection: PoolConnection): Promise<void> {
        return connection.rollback();
    }

    /**
     * Performs an individual query and returns the result
     *
     * @param query
     * @param values
     * @param connection
     */
    private async _query<RecordType = any> (
        query: string | MySQL.Query,
        values: any[] = [],
        connection: Pool | PoolConnection = this.pool
    ): Promise<MySQL.Query.Result<RecordType>> {
        if (typeof query === 'object') {
            if (query.values) {
                values = query.values;
            }

            query = query.query;
        }

        const result = await connection.query(query, values);

        if (isOkPacket(result)) {
            return [[], {
                changedRows: result.changedRows ?? 0,
                affectedRows: result.affectedRows ?? 0,
                insertId: result.insertId ?? 0,
                length: 0
            }, { query, values }];
        }

        const results = result as RecordType[];

        return [results, {
            changedRows: 0,
            affectedRows: 0,
            insertId: undefined,
            length: results.length
        }, { query, values }];
    }
}

export namespace MySQL {
    export type Config = MySQLPoolConfig & { rejectUnauthorized?: boolean; useSSL?: boolean };

    export type Query = Database.Query;

    export namespace Query {
        export type Result<Type = any> = Database.Query.Result<Type>;
    }
}

export default MySQL;
