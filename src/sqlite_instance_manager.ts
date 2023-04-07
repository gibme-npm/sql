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

import { createHash } from 'crypto';
import { resolve } from 'path';
import SQLiteInstance, { DatabaseOpenMode, OpenMode } from './sqlite_instance';

/** @ignore */
const digest = (value: string): string => {
    return createHash('sha512')
        .update(value)
        .digest()
        .toString('hex');
};

export { SQLiteInstance, DatabaseOpenMode, OpenMode };

export default class SQLiteInstanceManager {
    private static instances: Map<string, SQLiteInstance> = new Map<string, SQLiteInstance>();

    /**
     * Retrieves a singleton instance of SQLite based upon the supplied filename
     * or, creates a new instance if one does not already exist
     *
     * @param filename
     * @param mode
     * @param queueScanInterval
     */
    public static async get (
        filename: string,
        mode: OpenMode = DatabaseOpenMode.CREATE | DatabaseOpenMode.READWRITE | DatabaseOpenMode.FULL_MUTEX,
        queueScanInterval = 10
    ): Promise<SQLiteInstance> {
        // resolve the relative path to the absolute path
        filename = resolve(process.cwd(), filename);

        const id = digest(filename);

        {
            const instance = SQLiteInstanceManager.instances.get(id);

            if (instance) {
                return instance;
            }
        }

        const instance = await SQLiteInstance.load(id, filename, mode, queueScanInterval);

        SQLiteInstanceManager.instances.set(id, instance);

        return instance;
    }
}
