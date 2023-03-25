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

import { describe } from 'mocha';
import { Postgres, MySQL, SQLite } from '../src';
import { runTests, test_table } from './common';
import { config } from 'dotenv';
import { resolve } from 'path';
import { unlink } from 'fs/promises';

const test_db = resolve(`${process.cwd()}/${test_table}.sqlite3`);

config();

describe('SQLite Unit Tests', async () => {
    const sqlite = new SQLite({
        filename: test_db
    });

    before(async () => {
        await sqlite.dropTable(test_table);
    });

    after(async () => {
        await sqlite.dropTable(test_table);

        await sqlite.close();

        try {
            await unlink(test_db);
        } catch {}
    });

    describe('', () => {
        runTests(sqlite, SQLite.escapeId);
    });
});

describe('MySQL Unit Tests', async () => {
    const mysql = new MySQL({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        user: process.env.MYSQL_USER || '',
        password: process.env.MYSQL_PASSWORD || undefined,
        database: process.env.MYSQL_DATABASE || undefined,
        connectTimeout: 30_000
    });

    before(async () => {
        await mysql.dropTable(test_table);
    });

    after(async () => {
        await mysql.dropTable(test_table);

        await mysql.close();
    });

    describe('', () => {
        runTests(mysql, MySQL.escapeId);
    });
});

describe('Postgres Unit Tests', async () => {
    const postgres = new Postgres({
        host: process.env.PGSQL_HOST || '127.0.0.1',
        user: process.env.PGSQL_USER || '',
        password: process.env.PGSQL_PASSWORD || undefined,
        database: process.env.PGSQL_DATABASE || undefined
    });

    before(async () => {
        await postgres.dropTable(test_table);
    });

    after(async () => {
        await postgres.dropTable(test_table);

        await postgres.close();
    });

    describe('', () => {
        runTests(postgres, Postgres.escapeId);
    });
});
