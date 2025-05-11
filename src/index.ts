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

import Postgres from './postgres';
import MySQL from './mysql';
import SQLite from './sqlite';
import LibSQL from './libsql';
import Database from './database';
import MariaDB from './mariadb';
import { config } from 'dotenv';

config();

export const createConnection = (
    database_type: Database.Type = parseInt(process.env.SQL_TYPE || '2') || Database.Type.SQLITE,
    options: Partial<Postgres.Config | MySQL.Config | SQLite.Config | LibSQL.Config> = {}
): Database => {
    switch (database_type) {
        case Database.Type.SQLITE:
            return new SQLite({
                filename: process.env.SQL_FILENAME,
                ...options as any
            });
        case Database.Type.MYSQL:
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
        case Database.Type.MARIADB:
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
        case Database.Type.POSTGRES:
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
        case Database.Type.LIBSQL:
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
    Postgres, MySQL, MariaDB, SQLite, Database, LibSQL
};
