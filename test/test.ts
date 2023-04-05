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

import { describe, after } from 'mocha';
import { Postgres, MySQL, SQLite, PostgresPoolConfig, MySQLPoolConfig, SQLiteConfig } from '../src';
import { runTests, test_table } from './common';
import { config } from 'dotenv';
import { resolve } from 'path';
import { unlink } from 'fs/promises';

const test_db = resolve(`${process.cwd()}/${test_table}.sqlite3`);

config();

const engines = [SQLite, MySQL, Postgres];

for (const Engine of engines) {
    describe(Engine.type, async function () {
        const config: any = (() => {
            switch (Engine.type.toLowerCase()) {
                case 'sqlite':
                    return { filename: test_db } as SQLiteConfig;
                case 'mysql':
                    return {
                        host: process.env.MYSQL_HOST,
                        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : undefined,
                        user: process.env.MYSQL_USER,
                        password: process.env.MYSQL_PASSWORD,
                        database: process.env.MYSQL_DATABASE,
                        connectTimeout: 30_000
                    } as MySQLPoolConfig;
                case 'postgres':
                    return {
                        host: process.env.PGSQL_HOST,
                        port: process.env.PGSQL_PORT ? parseInt(process.env.PGSQL_PORT) : undefined,
                        user: process.env.PGSQL_USER,
                        password: process.env.PGSQL_PASSWORD,
                        database: process.env.PGSQL_DATABASE
                    } as PostgresPoolConfig;
            }
        })();

        const storage = new Engine(config);

        before(async () => {
            await storage.dropTable(test_table);
        });

        after(async () => {
            await storage.dropTable(test_table);

            await storage.close();

            if (Engine.type.toLowerCase() === 'sqlite') {
                try {
                    await unlink(test_db);
                } catch {}
            }
        });

        describe('Unit Tests', () => {
            runTests(storage, Engine.escapeId);
        });
    });
}
