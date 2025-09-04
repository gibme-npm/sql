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

import { after, describe } from 'mocha';
import { Database, MySQL, Postgres, SQLite, MariaDB } from '../src';
import { runTests, test_table } from './common';
import { config } from 'dotenv';
import { resolve } from 'path';
import { unlink } from 'fs/promises';

const test_db = resolve(`${process.cwd()}/${test_table}.sqlite3`);

config();

const engines: Database[] = [
    new SQLite({ filename: test_db })
];

if (process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_PASSWORD && process.env.MYSQL_DATABASE) {
    engines.push(new MySQL({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : undefined,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        useSSL: process.env.MYSQL_SSL === 'true',
        connectTimeout: 30_000
    }));
}

if (process.env.MARIADB_HOST && process.env.MARIADB_USER &&
    process.env.MARIADB_PASSWORD && process.env.MARIADB_DATABASE) {
    engines.push(new MariaDB({
        host: process.env.MARIADB_HOST,
        port: process.env.MARIADB_PORT ? parseInt(process.env.MARIADB_PORT) : undefined,
        user: process.env.MARIADB_USER,
        password: process.env.MARIADB_PASSWORD,
        database: process.env.MARIADB_DATABASE,
        useSSL: process.env.MARIADB_SSL === 'true',
        connectTimeout: 30_000
    }));
}

if (process.env.PGSQL_HOST && process.env.PGSQL_USER && process.env.PGSQL_PASSWORD && process.env.PGSQL_DATABASE) {
    engines.push(new Postgres({
        host: process.env.PGSQL_HOST,
        port: process.env.PGSQL_PORT ? parseInt(process.env.PGSQL_PORT) : undefined,
        user: process.env.PGSQL_USER,
        password: process.env.PGSQL_PASSWORD,
        database: process.env.PGSQL_DATABASE
    }));
}

for (const storage of engines) {
    describe(storage.typeName, async function () {
        before(async () => {
            await storage.dropTable(test_table);
        });

        after(async () => {
            await storage.dropTable(test_table);

            await storage.close();

            if (storage.type === Database.Type.SQLITE) {
                try {
                    await unlink(test_db);
                } catch {}
            }
        });

        describe('Unit Tests', () => {
            runTests(storage);
        });
    });
}
