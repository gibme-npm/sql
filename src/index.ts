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

import Postgres, { PoolConfig as PostgresPoolConfig } from './postgres';
import MySQL, { PoolConfig as MySQLPoolConfig } from './mysql';
import SQLite, { DatabaseConfig as SQLiteConfig } from './sqlite';
import LibSQL, { DatabaseConfig as LibSQLConfig, DBPath as LibSQLDBPath } from './libsql';
import Database from './database';

export * from './types';

export default {
    Postgres,
    MySQL,
    SQLite,
    LibSQL,
    Database
};

export {
    Postgres, MySQL, SQLite, Database, PostgresPoolConfig,
    MySQLPoolConfig, SQLiteConfig, LibSQL, LibSQLConfig, LibSQLDBPath
};
