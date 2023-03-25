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

import { Database } from 'sqlite3';
import { createHash } from 'crypto';

/** @ignore */
const connections: Map<string, Database> = new Map<string, Database>();

export enum DatabaseOpenMode {
    READONLY = 0x00000001,
    READWRITE = 0x00000002,
    CREATE = 0x00000004,
    DELETEONCLOSE = 0x00000008,
    EXCLUSIVE = 0x00000010,
    AUTOPROXY = 0x00000020,
    URI = 0x00000040,
    MEMORY = 0x00000080,
    MAIN_DB = 0x00000100,
    TEMP_DB = 0x00000200,
    TRANSIENT_DB = 0x00000400,
    MAIN_JOURNAL = 0x00000800,
    TEMP_JOURNAL = 0x00001000,
    SUB_JOURNAL = 0x00002000,
    SUPER_JOURNAL = 0x00004000,
    NO_MUTEX = 0x00008000,
    FULL_MUTEX = 0x00010000,
    SHAREDCACHE = 0x00020000,
    PRIVATECACHE = 0x00040000,
    WAL = 0x00080000,
    NOFOLLOW = 0x01000000,
    EXRESCODE = 0x02000000
}

export type OpenMode = number;

export type SQLiteDatabase = Database;

const digest = (value: string): string => {
    return createHash('sha512')
        .update(value)
        .digest()
        .toString('hex');
};

/**
 * Opens a SQLite database
 *
 * @param filename
 * @param mode
 */
const open = async (
    filename: string,
    mode: OpenMode = DatabaseOpenMode.CREATE | DatabaseOpenMode.READWRITE | DatabaseOpenMode.FULL_MUTEX
): Promise<SQLiteDatabase> => {
    return new Promise((resolve, reject) => {
        const database: SQLiteDatabase = new Database(filename, mode, error => {
            if (error) {
                return reject(error);
            }

            return resolve(database);
        });
    });
};

/**
 * Retrieves a SQLite database connection from the cache if available; otherwise,
 * it opens the connection
 *
 * @param filename
 * @param mode
 */
export const getConnection = async (
    filename: string,
    mode: OpenMode = DatabaseOpenMode.CREATE | DatabaseOpenMode.READWRITE | DatabaseOpenMode.FULL_MUTEX
): Promise<SQLiteDatabase> => {
    const id = digest(filename);

    {
        const connection = connections.get(id);

        if (connection) {
            return connection;
        }
    }

    const connection = await open(filename, mode);

    connections.set(id, connection);

    return connection;
};
