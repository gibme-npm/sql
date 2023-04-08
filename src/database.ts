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
import { Column, DatabaseType, Query, QueryResult } from './types';
import { format } from 'util';
import pgformat from 'pg-format';
import { escape as mysqlEscape, escapeId as mysqlEscapeId } from 'mysql';

/**
 * The core interface for all database types
 */
export interface IDatabase {
    type: DatabaseType;
    typeName: string;
    escape: (value: string) => string;
    escapeId: (id: string) => string;
    tableOptions: string;
    close: () => Promise<void>;
    createTable: (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions?: string,
        useTransaction?: boolean
    ) => Promise<void>;
    use: (database: string) => Promise<IDatabase>;
    listTables: (database?: string) => Promise<string[]>;
    dropTable: (tables: string | string[]) => Promise<QueryResult[]>;
    query: <RecordType = any>(
        query: string | Query,
        ...values: any[]
    ) => Promise<QueryResult<RecordType>>;
    multiInsert: (
        table: string,
        columns: string[],
        values: any[][],
        useTransaction?: boolean
    ) => Promise<QueryResult>;
    multiUpdate: (
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][],
        useTransaction?: boolean
    ) => Promise<QueryResult>;
    transaction: (queries: Query[]) => Promise<QueryResult[]>;
    prepareMultiInsert: (
        table: string,
        columns: string[],
        values: any[][]
    ) => Query[];
    prepareMultiUpdate: (
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][]
    ) => Query[];
    prepareCreateTable: (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions?: string
    ) => Query[];
}

export default abstract class Database extends EventEmitter implements IDatabase {
    protected constructor (
        public readonly type: DatabaseType,
        public tableOptions = ''
    ) {
        super();
    }

    public get typeName (): string {
        switch (this.type) {
            case DatabaseType.LIBSQL:
                return 'LibSQL';
            case DatabaseType.MYSQL:
                return 'MySQL';
            case DatabaseType.POSTGRES:
                return 'Postgres';
            case DatabaseType.SQLITE:
                return 'SQLite';
        }
    }

    abstract close(): Promise<void>;

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
                query: `DROP TABLE IF EXISTS ${this.escapeId(table)}`
            });
        }

        return this.transaction(queries);
    }

    /**
     * Escapes the value for SQL
     *
     * @param value
     */
    public escape (value: string): string {
        console.log(this.type);

        if (this.type === DatabaseType.POSTGRES) {
            return pgformat('%L', value);
        }

        return mysqlEscape(value);
    }

    /**
     * Escapes the ID for sql
     *
     * @param id
     */
    public escapeId (id: string): string {
        if (this.type === DatabaseType.POSTGRES) {
            return pgformat('%I', id);
        }

        return mysqlEscapeId(id);
    }

    abstract listTables(database?: string): Promise<string[]>;

    abstract query<RecordType>(
        query: string | Query,
        ...values: any[]
    ): Promise<QueryResult<RecordType>>;

    abstract transaction(queries: Query[]): Promise<QueryResult[]>;

    abstract use(database: string): Promise<IDatabase>;

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
        return this._prepareMultiInsert(this.type, table, columns, values);
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
        return this._prepareMultiUpdate(this.type, table, primaryKey, columns, values);
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
        return this._prepareCreateTable(name, fields, primaryKey, tableOptions);
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

        return this._executeMulti(queries, useTransaction);
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

        return this._executeMulti(queries, useTransaction);
    }

    /**
     * Prepares the creation of a table including the relevant indexes and constraints
     *
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     */
    protected _prepareCreateTable (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions: string
    ): Query[] {
        name = this.escapeId(name);
        primaryKey = primaryKey.map(column => this.escapeId(column));

        const sqlToQuery = (sql: string, values: any[] = []): Query => {
            return {
                query: sql.trim(),
                values
            };
        };

        const values: any[] = [];

        const _fields = fields.map(column => {
            if (typeof column.default !== 'undefined') {
                values.push(column.default);
            }

            return format('%s %s %s %s',
                this.escapeId(column.name),
                column.type.toUpperCase(),
                !column.nullable ? 'NOT NULL' : 'NULL',
                typeof column.default !== 'undefined' ? 'DEFAULT ?' : '')
                .trim();
        });

        const _unique = fields.filter(elem => elem.unique === true)
            .map(column => format('CREATE UNIQUE INDEX IF NOT EXISTS %s_unique_%s ON %s (%s)',
                name,
                this.escapeId(column.name),
                name,
                this.escapeId(column.name.trim())));

        const constraint_fmt = ', CONSTRAINT %s_%s_foreign_key FOREIGN KEY (%s) REFERENCES %s (%s)';

        const _constraints: string[] = [];

        for (const field of fields) {
            if (field.foreignKey) {
                let constraint = format(constraint_fmt,
                    name,
                    this.escapeId(field.name),
                    this.escapeId(field.name),
                    field.foreignKey.table,
                    field.foreignKey.column);

                if (field.foreignKey.onDelete) {
                    constraint += format(' ON DELETE %s', field.foreignKey.onDelete);
                }

                if (field.foreignKey.onUpdate) {
                    constraint += format(' ON UPDATE %s', field.foreignKey.onUpdate);
                }

                _constraints.push(constraint.trim());
            }
        }

        const sql = format('CREATE TABLE IF NOT EXISTS %s (%s, PRIMARY KEY (%s)%s) %s;',
            name,
            _fields.join(','),
            primaryKey.join(','),
            _constraints.join(','),
            tableOptions);

        return [sqlToQuery(sql, values), ..._unique.map(sql => sqlToQuery(sql))];
    }

    /**
     * Prepares a query to perform a multi-insert statement which is far faster than
     * a bunch of individual insert statements
     *
     * @param databaseType
     * @param table
     * @param columns
     * @param values
     */
    protected _prepareMultiInsert (
        databaseType: DatabaseType,
        table: string,
        columns: string[] = [],
        values: any[][]
    ): Query[] {
        const toPlaceholders = (arr: any[]): string => {
            return arr.map(() => '?')
                .join(',');
        };

        if (values.length === 0) {
            throw new Error('Must supply values');
        }

        if (columns.length !== 0) {
            for (const _values of values) {
                if (_values.length !== columns.length) {
                    throw new Error('Column count does not match values count');
                }
            }
        }

        const _columns = columns.length !== 0 ? ` (${columns.map(elem => this.escapeId(elem)).join(',')})` : '';

        // SQLite handles things a bit differently
        if (databaseType === DatabaseType.SQLITE || databaseType === DatabaseType.LIBSQL) {
            const queries: Query[] = [];

            for (const _values of values) {
                queries.push({
                    query: `INSERT INTO ${this.escapeId(table)}${_columns} VALUES (${toPlaceholders(_values)})`,
                    values: _values
                });
            }

            return queries;
        }

        const placeholders: string[] = [];
        const parameters: any[] = [];

        const placeholder = columns.length !== 0 ? `(${toPlaceholders(columns)})` : `(${toPlaceholders(values[0])})`;

        for (const _values of values) {
            placeholders.push(placeholder);
            parameters.push(..._values);
        }

        return [{
            query: `INSERT INTO ${this.escapeId(table)}${_columns} VALUES ${placeholders.join(',')}`.trim(),
            values: parameters
        }];
    }

    /**
     * Prepares a query to perform a multi-update statement which is based upon a multi-insert statement
     * that performs an UPSERT and this is a lot faster than a bunch of individual
     * update statements
     *
     * @param databaseType
     * @param table
     * @param primaryKey
     * @param columns
     * @param values
     */
    protected _prepareMultiUpdate (
        databaseType: DatabaseType,
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][]
    ): Query[] {
        if (columns.length === 0) {
            throw new Error('Must specify columns for multi-update');
        }

        if (primaryKey.length === 0) {
            throw new Error('Must specify primary key column(s) for multi-update');
        }

        const queries = this._prepareMultiInsert(databaseType, table, columns, values);

        const updates: string[] = [];

        if (databaseType === DatabaseType.MYSQL) {
            for (const column of columns) {
                if (primaryKey.includes(column)) {
                    continue;
                }

                updates.push(`${this.escapeId(column)} = VALUES(${this.escapeId(column)})`);
            }

            return queries.map(query => {
                query.query += ` ON DUPLICATE KEY UPDATE ${updates.join(',')}`;

                return query;
            });
        }

        for (const column of columns) {
            if (primaryKey.includes(column)) {
                continue;
            }

            updates.push(`${this.escapeId(column)} = excluded.${this.escapeId(column)}`);
        }

        return queries.map(query => {
            query.query += ` ON CONFLICT (${primaryKey.map(elem => this.escapeId(elem)).join(',')}) ` +
                `DO UPDATE SET ${updates.join(',')}`;

            return query;
        });
    }

    protected async _executeMulti (
        queries: Query[],
        useTransaction: boolean
    ): Promise<QueryResult> {
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
}
