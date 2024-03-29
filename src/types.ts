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

/**
 * The DBMS type
 */
export enum DatabaseType {
    MYSQL,
    POSTGRES,
    SQLITE,
    LIBSQL,
    MARIADB
}

/**
 * Query result meta data
 */
export interface QueryMetaData {
    changedRows: number;
    affectedRows: number;
    insertId?: number;
    length: number;
}

/**
 * A query
 */
export interface Query {
    query: string;
    values?: any[];
    noError?: boolean;
}

/**
 * A Query result
 */
export type QueryResult<RecordType = any> = [RecordType[], QueryMetaData, Query];

/**
 * Index types supported
 */
export enum IndexType {
    NONE = '',
    UNIQUE = 'UNIQUE'
}

/**
 * Foreign key constraint types
 */
export enum ForeignKeyConstraint {
    RESTRICT = 'RESTRICT',
    CASCADE = 'CASCADE',
    NULL = 'SET NULL',
    DEFAULT = 'SET DEFAULT',
    NA = 'NO ACTION'
}

/**
 * A foreign key description
 */
export interface ForeignKey {
    table: string;
    column: string;
    onUpdate?: ForeignKeyConstraint;
    onDelete?: ForeignKeyConstraint;
}

/**
 * A column description
 */
export interface Column {
    name: string;
    type: string;
    nullable?: boolean;
    foreignKey?: ForeignKey;
    unique?: boolean;
    default?: string | number | boolean;
}

/** @ignore */
export const make_error = (error: any): Error => {
    if (error instanceof Error) {
        return error;
    }

    return new Error(error.toString());
};
