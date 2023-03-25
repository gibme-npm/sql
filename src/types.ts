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

export enum DatabaseType {
    MYSQL,
    POSTGRES,
    SQLITE
}

export interface QueryMetaData {
    changedRows: number;
    affectedRows: number;
    insertId?: number;
    length: number;
}

export interface Query {
    query: string;
    values?: any[];
}

export type QueryResult<RecordType = any> = [RecordType[], QueryMetaData, Query];

export enum ForeignKeyConstraint {
    RESTRICT = 'RESTRICT',
    CASCADE = 'CASCADE',
    NULL = 'SET NULL',
    DEFAULT = 'SET DEFAULT',
    NA = 'NO ACTION'
}

export interface ForeignKey {
    table: string;
    column: string;
    onUpdate?: ForeignKeyConstraint;
    onDelete?: ForeignKeyConstraint;
}

export interface Column {
    name: string;
    type: string;
    nullable?: boolean;
    foreignKey?: ForeignKey;
    unique?: boolean;
    default?: string | number | boolean;
}

/** @ignore */
interface Callback<Type = any> {
    callback: (error: Error | undefined, results?: QueryResult<Type>[]) => void;
}

/** @ignore */
export enum QueueEntryType {
    TRANSACTION,
    ALL,
    RUN
}

/** @ignore */
export interface QueueEntry<Type = any> extends Callback<Type> {
    type: QueueEntryType;
    query?: string;
    values?: any[];
    queries?: Query[];
}

export interface Database {
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
    use: (database: string) => Promise<Database>;
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
