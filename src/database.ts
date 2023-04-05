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

/**
 * The core interface for all database types
 */
export interface IDatabase {
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
        values: any[],
        connection?: any
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
    abstract close(): Promise<void>;

    abstract createTable(
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions?: string,
        useTransaction?: boolean
    ): Promise<void>;

    abstract dropTable(tables: string | string[]): Promise<QueryResult[]>;

    abstract escape(value: string): string;

    abstract escapeId(id: string): string;

    abstract listTables(database?: string): Promise<string[]>;

    abstract multiInsert(
        table: string,
        columns: string[],
        values: any[][],
        useTransaction?: boolean
    ): Promise<QueryResult>;

    abstract multiUpdate(
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][],
        useTransaction?: boolean
    ): Promise<QueryResult>;

    abstract prepareCreateTable(
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions?: string
    ): Query[];

    abstract prepareMultiInsert(
        table: string,
        columns: string[],
        values: any[][]
    ): Query[];

    abstract prepareMultiUpdate(
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][]
    ): Query[];

    abstract query<RecordType>(
        query: string | Query,
        values: any[],
        connection?: any
    ): Promise<QueryResult<RecordType>>;

    abstract tableOptions: string;

    abstract transaction(queries: Query[]): Promise<QueryResult[]>;

    abstract use(database: string): Promise<IDatabase>;

    /**
     * Prepares the creation of a table including the relevant indexes and constraints
     *
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     * @param escapeId
     */
    protected _prepareCreateTable (
        name: string,
        fields: Column[],
        primaryKey: string[],
        tableOptions: string,
        escapeId: (value: string) => string
    ): Query[] {
        name = escapeId(name);
        primaryKey = primaryKey.map(column => escapeId(column));

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
                escapeId(column.name),
                column.type.toUpperCase(),
                !column.nullable ? 'NOT NULL' : 'NULL',
                typeof column.default !== 'undefined' ? 'DEFAULT ?' : '')
                .trim();
        });

        const _unique = fields.filter(elem => elem.unique === true)
            .map(column => format('CREATE UNIQUE INDEX IF NOT EXISTS %s_unique_%s ON %s (%s)',
                name,
                escapeId(column.name),
                name,
                escapeId(column.name.trim())));

        const constraint_fmt = ', CONSTRAINT %s_%s_foreign_key FOREIGN KEY (%s) REFERENCES %s (%s)';

        const _constraints: string[] = [];

        for (const field of fields) {
            if (field.foreignKey) {
                let constraint = format(constraint_fmt,
                    name,
                    escapeId(field.name),
                    escapeId(field.name),
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
     * @param escapeId
     */
    protected _prepareMultiInsert (
        databaseType: DatabaseType,
        table: string,
        columns: string[] = [],
        values: any[][],
        escapeId: (value: string) => string
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

        const _columns = columns.length !== 0 ? ` (${columns.map(elem => escapeId(elem)).join(',')})` : '';

        // SQLite handles things a bit differently
        if (databaseType === DatabaseType.SQLITE) {
            const queries: Query[] = [];

            for (const _values of values) {
                queries.push({
                    query: `INSERT INTO ${escapeId(table)}${_columns} VALUES (${toPlaceholders(_values)})`,
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
            query: `INSERT INTO ${escapeId(table)}${_columns} VALUES ${placeholders.join(',')}`.trim(),
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
     * @param escapeId
     */
    protected _prepareMultiUpdate (
        databaseType: DatabaseType,
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][],
        escapeId: (value: string) => string
    ): Query[] {
        if (columns.length === 0) {
            throw new Error('Must specify columns for multi-update');
        }

        if (primaryKey.length === 0) {
            throw new Error('Must specify primary key column(s) for multi-update');
        }

        const queries = this._prepareMultiInsert(databaseType, table, columns, values, escapeId);

        const updates: string[] = [];

        if (databaseType === DatabaseType.MYSQL) {
            for (const column of columns) {
                if (primaryKey.includes(column)) {
                    continue;
                }

                updates.push(`${escapeId(column)} = VALUES(${escapeId(column)})`);
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

            updates.push(`${escapeId(column)} = excluded.${escapeId(column)}`);
        }

        return queries.map(query => {
            query.query += ` ON CONFLICT (${primaryKey.map(elem => escapeId(elem)).join(',')}) ` +
        `DO UPDATE SET ${updates.join(',')}`;

            return query;
        });
    }
}
