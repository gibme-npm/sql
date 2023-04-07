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

import { describe, it } from 'mocha';
import * as assert from 'assert';
import { config } from 'dotenv';
import { createHash } from 'crypto';
import { Database } from '../src';

config();

const digest = (value: string): string => {
    return createHash('sha512')
        .update(value)
        .digest()
        .toString('hex')
        .substring(0, 10);
};

export const test_table = digest(process.env.SQL_TABLE || 'test');
const second_table = digest(test_table);

export const runTests = (
    db: Database
): void => {
    const values: any[][] = [];

    for (let i = 0; i < 100; i++) {
        values.push([`test${i}`, i]);
    }

    describe('Tables', () => {
        it(`Create ${test_table}`, async () => {
            await db.createTable(test_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)'
                },
                {
                    name: 'column2',
                    type: 'integer'
                }
            ], ['column1']);

            await db.listTables();
        });

        it('List', async () => {
            const tables = await db.listTables();

            assert.equal(tables.includes(test_table), true, `${test_table} not found`);
        });

        it(`Drop ${second_table}`, async () => {
            await db.createTable(second_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)'
                },
                {
                    name: 'column2',
                    type: 'integer'
                }
            ], ['column1']);

            {
                const tables = await db.listTables();

                assert.equal(tables.includes(second_table), true, `${second_table} not found`);
            }

            await db.dropTable(second_table);

            {
                const tables = await db.listTables();

                assert.equal(tables.includes(second_table), false, `${second_table} found`);
            }
        });
    });

    describe('Bulk Insert / Updates', () => {
        it('Bulk Insert', async () => {
            return db.multiInsert(
                test_table,
                ['column1', 'column2'],
                values);
        });

        it('Bulk Update', async () => {
            return db.multiUpdate(
                test_table,
                ['column1'],
                ['column1', 'column2'],
                values.map(row => {
                    row[1]++;

                    return row;
                }));
        });
    });

    describe('Queries', () => {
        it('Select', async () => {
            const [rows] = await db.query<{ column1: string, column2: number }>(
                `SELECT * FROM ${db.escapeId(test_table)} WHERE ${db.escapeId('column1')} = ?`,
                [values[0][0]]
            );

            assert.equal(rows[0].column2, 1, 'Column2 value incorrect');
        });

        it('Delete', async () => {
            const [, meta] = await db.query(
                `DELETE FROM ${db.escapeId(test_table)} WHERE ${db.escapeId('column1')} = ?`,
                [values[0][0]]
            );

            assert.equal(meta.affectedRows, 1, 'Affected rows value incorrect');
        });

        it('Update', async () => {
            await db.query(
                `UPDATE ${db.escapeId(test_table)} SET ${db.escapeId('column2')} = ? ` +
                `WHERE ${db.escapeId('column1')} = ?`,
                [5, values[1][0]]
            );

            const [rows] = await db.query<{ column1: string, column2: number }>(
                `SELECT * FROM ${db.escapeId(test_table)} WHERE ${db.escapeId('column1')} = ?`,
                [values[1][0]]
            );

            assert.equal(rows[0].column2, 5, 'Column2 value incorrect');
        });
    });
};
