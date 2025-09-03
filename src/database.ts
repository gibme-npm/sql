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

import { EventEmitter } from 'events';
import pgformat from 'pg-format';
import { escape as mysqlEscape, escapeId as mysqlEscapeId } from 'sqlstring';

export abstract class Database extends EventEmitter {
    protected constructor (
        public readonly type: Database.Type,
        public tableOptions = ''
    ) {
        super();
    }

    public get typeName (): string {
        switch (this.type) {
            case Database.Type.MYSQL:
                return 'MySQL';
            case Database.Type.POSTGRES:
                return 'Postgres';
            case Database.Type.SQLITE:
                return 'SQLite';
            case Database.Type.MARIADB:
                return 'MariaDB';
        }
    }

    abstract close(): Promise<void>;

    /**
     * Drop the tables from the database
     *
     * @param tables
     */
    public async dropTable (tables: string | string[]): Promise<Database.Query.Result[]> {
        if (!Array.isArray(tables)) {
            tables = [tables];
        }

        const queries: Database.Query[] = [];

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
        if (this.type === Database.Type.POSTGRES) {
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
        if (this.type === Database.Type.POSTGRES) {
            return pgformat('%I', id);
        }

        return mysqlEscapeId(id);
    }

    abstract listTables(database?: string): Promise<string[]>;

    abstract query<RecordType>(
        query: string | Database.Query,
        ...values: any[]
    ): Promise<Database.Query.Result<RecordType>>;

    abstract transaction<RecordType = any>(queries: Database.Query[]): Promise<Database.Query.Result<RecordType>[]>;

    abstract use(database: string): Promise<Database>;

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
    ): Database.Query[] {
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
    ): Database.Query[] {
        return this._prepareMultiUpdate(this.type, table, primaryKey, columns, values);
    }

    /**
     * Prepares the creation of an index on the specified table
     * @param table
     * @param fields
     * @param type
     */
    public prepareCreateIndex (
        table: string,
        fields: string[],
        type: Database.Table.IndexType = Database.Table.IndexType.NONE
    ): Database.Query[] {
        return [this._prepareCreateIndex(this.type, table, fields, type)];
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
        fields: Database.Table.Column[],
        primaryKey: string[] = [],
        tableOptions = this.tableOptions
    ): Database.Query[] {
        return this._prepareCreateTable(this.type, name, fields, primaryKey, tableOptions);
    }

    /**
     * Prepares and executes the creation of a table including the relevant indexes and
     * constraints
     *
     * @param name
     * @param fields
     * @param primaryKey
     * @param tableOptions
     * @param useTransaction
     */
    public async createTable (
        name: string,
        fields: Database.Table.Column[],
        primaryKey: string[] = [],
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
     * Prepares and executes the creation of an index on the table specified
     *
     * @param table
     * @param fields
     * @param type
     * @param useTransaction
     */
    public async createIndex (
        table: string,
        fields: string[],
        type: Database.Table.IndexType = Database.Table.IndexType.NONE,
        useTransaction = true
    ): Promise<void> {
        const queries = this.prepareCreateIndex(table, fields, type);

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
    ): Promise<Database.Query.Result> {
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
    ): Promise<Database.Query.Result> {
        const queries = this.prepareMultiUpdate(table, primaryKey, columns, values);

        return this._executeMulti(queries, useTransaction);
    }

    /**
     * Truncates the specified table(s)
     *
     * @param table
     * @param useTransaction
     */
    public async truncate (
        table: string | string[],
        useTransaction = true
    ): Promise<boolean> {
        if (!Array.isArray(table)) {
            table = [table];
        }

        const queries: Database.Query[] = [];

        switch (this.type) {
            case Database.Type.SQLITE:
                table.forEach(table => queries.push({ query: `DELETE FROM ${this.escapeId(table)}` }));
                break;
            default:
                table.forEach(table => queries.push({ query: `TRUNCATE TABLE ${this.escapeId(table)}` }));
                break;
        }

        try {
            if (useTransaction) {
                await this.transaction(queries);
            } else {
                for (const query of queries) {
                    await this.query(query);
                }
            }

            return true;
        } catch {
            return false;
        }
    }

    protected abstract connection(): Promise<any>;

    protected abstract beginTransaction(connection: any): Promise<any>;

    protected abstract commitTransaction(connection: any): Promise<void>;

    protected abstract rollbackTransaction(connection: any): Promise<void>;

    /**
     * Prepares any foreign key constraints based upon the field supplied
     *
     * @param table
     * @param fields
     * @protected
     */
    protected _prepareConstraints (
        table: string,
        fields: Database.Table.Column[]
    ): string[] {
        table = table.trim();

        const constraints: string[] = [];

        for (const field of fields) {
            if (field.foreignKey) {
                field.name = field.name.trim();
                field.foreignKey.table = field.foreignKey.table.trim();
                field.foreignKey.column = field.foreignKey.column.trim();

                const key_name = [
                    'fk',
                    table,
                    field.name,
                    field.foreignKey.table,
                    field.foreignKey.column
                ].join('_');

                let constraint = `CONSTRAINT ${key_name} ` +
                    `FOREIGN KEY (${this.escapeId(field.name)}) ` +
                    `REFERENCES ${this.escapeId(field.foreignKey.table)} ` +
                    `(${this.escapeId(field.foreignKey.column)})`;

                if (field.foreignKey.onDelete) {
                    constraint += ` ON DELETE ${field.foreignKey.onDelete}`;
                }

                if (field.foreignKey.onUpdate) {
                    constraint += ` ON UPDATE ${field.foreignKey.onUpdate}`;
                }

                constraints.push(constraint.trim());
            }
        }

        return constraints;
    }

    /**
     * Prepares the creation of an index on a table
     *
     * @param databaseType
     * @param table
     * @param fields
     * @param type
     * @protected
     */
    protected _prepareCreateIndex (
        databaseType: Database.Type,
        table: string,
        fields: string[],
        type: Database.Table.IndexType = Database.Table.IndexType.NONE
    ): Database.Query {
        table = table.trim();
        fields = fields.map(field => field.trim());

        const can_if_not_exists = databaseType !== Database.Type.MYSQL;
        const if_not_exists = can_if_not_exists ? ' IF NOT EXISTS' : '';

        return {
            query: `CREATE ${type} INDEX${if_not_exists} ${type.toLowerCase()}_${table}_${fields.join('_')} ` +
                `ON ${this.escapeId(table)} (${fields.map(elem => this.escapeId(elem)).join(',')})`,
            noError: !can_if_not_exists
        };
    }

    /**
     * Prepares statements to create indexes during a CREATE table statement
     *
     * @param databaseType
     * @param table
     * @param fields
     * @param type
     * @protected
     */
    protected _prepareCreateIndexes (
        databaseType: Database.Type,
        table: string,
        fields: Database.Table.Column[],
        type: Database.Table.IndexType = Database.Table.IndexType.NONE
    ): Database.Query[] {
        table = table.trim();

        return fields.filter(column => column.unique === true)
            .map(column =>
                this._prepareCreateIndex(databaseType, table, [column.name], type));
    }

    /**
     * Prepares the creation of a table including the relevant indexes and constraints
     *
     * @param databaseType
     * @param table
     * @param columns
     * @param primaryKey
     * @param tableOptions
     */
    protected _prepareCreateTable (
        databaseType: Database.Type,
        table: string,
        columns: Database.Table.Column[],
        primaryKey: string[] = [],
        tableOptions: string = ''
    ): Database.Query[] {
        table = table.trim();
        primaryKey = primaryKey.map(column => this.escapeId(column));

        const [fields, values] = this._prepareColumns(columns);

        const constraints = this._prepareConstraints(table, columns);

        const primary_key = primaryKey.length !== 0
            ? `, PRIMARY KEY (${primaryKey.join(', ')})`
            : '';

        const query = [
            'CREATE TABLE IF NOT EXISTS',
            this.escapeId(table),
            '(',
            fields.join(', '),
            primary_key,
            constraints.length !== 0 ? `, ${constraints.join(', ')}` : '',
            ')',
            tableOptions
        ].filter(elem => elem.length !== 0)
            .map(elem => elem.trim())
            .join(' ')
            .trim();

        const unique = this._prepareCreateIndexes(databaseType, table, columns, Database.Table.IndexType.UNIQUE);

        return [
            {
                query,
                values
            },
            ...unique
        ];
    }

    /**
     * Prepares the columns for a CREATE statement
     *
     * @param fields
     * @protected
     */
    protected _prepareColumns (
        fields: Database.Table.Column[]
    ): [string[], any[]] {
        const values: any[] = [];
        const columns: string[] = [];

        for (const column of fields) {
            if (typeof column.default !== 'undefined') {
                values.push(column.default);
            }

            columns.push(
                `${this.escapeId(column.name)} ${column.type.toUpperCase()} ` +
                `${!column.nullable ? 'NOT NULL' : 'NULL'} ` +
                `${typeof column.default !== 'undefined' ? 'DEFAULT ?' : ''}`
                    .trim()
            );
        }

        return [columns, values];
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
        databaseType: Database.Type,
        table: string,
        columns: string[] = [],
        values: any[][]
    ): Database.Query[] {
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
        if (databaseType === Database.Type.SQLITE) {
            const queries: Database.Query[] = [];

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
        databaseType: Database.Type,
        table: string,
        primaryKey: string[],
        columns: string[],
        values: any[][]
    ): Database.Query[] {
        if (columns.length === 0) {
            throw new Error('Must specify columns for multi-update');
        }

        if (primaryKey.length === 0) {
            throw new Error('Must specify primary key column(s) for multi-update');
        }

        const queries = this._prepareMultiInsert(databaseType, table, columns, values);

        const updates: string[] = [];

        if (databaseType === Database.Type.MYSQL || databaseType === Database.Type.MARIADB) {
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

    /**
     * Executes multiple statements and returns their results in a single Database.Query.Result
     *
     * @param queries
     * @param useTransaction
     * @protected
     */
    protected async _executeMulti (
        queries: Database.Query[],
        useTransaction: boolean
    ): Promise<Database.Query.Result> {
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

    /** @ignore */
    protected make_error (error: any): Error {
        if (error instanceof Error) {
            return error;
        }

        return new Error(error.toString());
    };
}

export namespace Database {
    export enum Type {
        MYSQL = 0,
        POSTGRES = 1,
        SQLITE = 2,
        MARIADB = 4
    }

    export namespace Table {
        export enum IndexType {
            NONE = '',
            UNIQUE = 'UNIQUE'
        }

        export enum ForeignKeyConstraint {
            RESTRICT = 'RESTRICT',
            CASCADE = 'CASCADE',
            NULL = 'SET NULL',
            DEFAULT = 'SET DEFAULT',
            NA = 'NO ACTION'
        }

        export type ForeignKey = {
            table: string;
            column: string;
            onUpdate?: ForeignKeyConstraint;
            onDelete?: ForeignKeyConstraint;
        }

        export type Column = {
            name: string;
            type: string;
            nullable?: boolean;
            foreignKey?: ForeignKey;
            unique?: boolean;
            default?: string | number | boolean;
        }
    }

    export type Query = {
        query: string;
        values?: any[];
        noError?: boolean;
    }

    export namespace Query {
        export type MetaData = {
            changedRows: number;
            affectedRows: number;
            insertId?: number;
            length: number;
        }

        export type Result<RecordType = any> = [RecordType[], Query.MetaData, Query];
    }
}

export default Database;
