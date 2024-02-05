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
import MySQL, { PoolConfig as MySQLPoolConfig, MySQLConfig } from './mysql';
import SQLite, { DatabaseConfig as SQLiteConfig } from './sqlite';
import LibSQL, { DatabaseConfig as LibSQLConfig, DBPath as LibSQLDBPath } from './libsql';
import Database, { IDatabase } from './database';
import { config } from 'dotenv';
import { DatabaseType } from './types';
import MariaDB from './mariadb';

export * from './types';

config();

export const createConnection = (
    database_type: DatabaseType = parseInt(process.env.SQL_TYPE || '2') || DatabaseType.SQLITE,
    options: Partial<PostgresPoolConfig | MySQLPoolConfig | SQLiteConfig | LibSQLConfig> = {}
): Database => {
    switch (database_type) {
        case DatabaseType.SQLITE:
            return new SQLite({
                filename: process.env.SQL_FILENAME,
                ...options as any
            });
        case DatabaseType.MYSQL:
            return new MySQL({
                host: process.env.SQL_HOST,
                port: parseInt(process.env.SQL_PORT || '') || undefined,
                user: process.env.SQL_USERNAME,
                password: process.env.SQL_PASSWORD,
                database: process.env.SQL_DATABASE,
                rejectUnauthorized: false,
                useSSL: process.env.SQL_SSL === 'true',
                ...options as any
            });
        case DatabaseType.MARIADB:
            return new MariaDB({
                host: process.env.SQL_HOST,
                port: parseInt(process.env.SQL_PORT || '') || undefined,
                user: process.env.SQL_USERNAME,
                password: process.env.SQL_PASSWORD,
                database: process.env.SQL_DATABASE,
                rejectUnauthorized: false,
                useSSL: process.env.SQL_SSL === 'true',
                ...options as any
            });
        case DatabaseType.POSTGRES:
            return new Postgres({
                host: process.env.SQL_HOST,
                port: parseInt(process.env.SQL_PORT || '') || undefined,
                user: process.env.SQL_USERNAME,
                password: process.env.SQL_PASSWORD,
                database: process.env.SQL_DATABASE,
                ssl: process.env.SQL_SSL === 'true',
                rejectUnauthorized: false,
                ...options as any
            });
        case DatabaseType.LIBSQL:
            return new LibSQL({
                url: process.env.SQL_URL,
                tls: process.env.SQL_SSL === 'true',
                ...options as any
            });
        default:
            throw new Error('Invalid database type specified');
    }
};

export default {
    Postgres,
    MySQL,
    SQLite,
    LibSQL,
    MariaDB,
    Database,
    createConnection
};

export {
    Postgres, MySQL, MariaDB, SQLite, Database, PostgresPoolConfig,
    MySQLPoolConfig, SQLiteConfig, LibSQL, LibSQLConfig, LibSQLDBPath, IDatabase, MySQLConfig
};
