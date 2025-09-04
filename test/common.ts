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

import { describe, it } from 'mocha';
import assert from 'assert';
import { config } from 'dotenv';
import { createHash } from 'crypto';
import { Database } from '../src';

config();

const digest = (value: string): string => {
    return createHash('sha512')
        .update(value)
        .update((new Date()).getTime().toString())
        .digest()
        .toString('hex')
        .substring(0, 10);
};

export const test_table = digest(process.env.SQL_TABLE || 'test');
const second_table = digest(test_table);
const third_table = digest(second_table);
const fourth_table = digest(third_table);
const fifth_table = digest(fourth_table);

export const runTests = (
    db: Database
): void => {
    const values: any[][] = [];

    for (let i = 0; i < 100; i++) {
        values.push([`test${i}`, i]);
    }

    const confirm_exists = async (table: string) => {
        const tables = await db.listTables();

        assert.ok(tables.includes(table), `Table ${table} does not exist`);
    };

    const confirm_exists_and_drop_table = async (table: string) => {
        await confirm_exists(table);

        await db.dropTable(table);

        const post_tables = await db.listTables();

        assert.ok(!post_tables.includes(table), `Table ${table} still exists`);
    };

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

            await confirm_exists(test_table);
        });

        it(`Create ${third_table} with unique index`, async () => {
            await db.createTable(third_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)'
                },
                {
                    name: 'column2',
                    type: 'integer',
                    unique: true
                }
            ], ['column1']);

            await confirm_exists_and_drop_table(third_table);
        });

        it(`Create ${fourth_table} with foreign key constraint`, async () => {
            await db.createTable(fourth_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)',
                    foreignKey: {
                        table: test_table,
                        column: 'column1',
                        onDelete: Database.Table.ForeignKeyConstraint.CASCADE,
                        onUpdate: Database.Table.ForeignKeyConstraint.CASCADE
                    }
                },
                {
                    name: 'column2',
                    type: 'integer'
                }
            ], ['column1']);

            await confirm_exists_and_drop_table(fourth_table);
        });

        it(`Create ${fifth_table} with no primary key`, async () => {
            await db.createTable(fifth_table, [
                {
                    name: 'column1',
                    type: 'varchar(255)',
                    foreignKey: {
                        table: test_table,
                        column: 'column1',
                        onDelete: Database.Table.ForeignKeyConstraint.CASCADE,
                        onUpdate: Database.Table.ForeignKeyConstraint.CASCADE
                    }
                },
                {
                    name: 'column2',
                    type: 'integer'
                }
            ]);

            await confirm_exists_and_drop_table(fifth_table);
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

            await confirm_exists_and_drop_table(second_table);
        });
    });

    describe('Bulk Insert / Updates', async () => {
        it('Bulk Insert', async () => {
            await db.multiInsert(
                test_table,
                ['column1', 'column2'],
                values);

            const [rows] = await db.query(`SELECT * FROM ${db.escapeId(test_table)}`);

            assert.equal(rows.length, values.length);
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
                values[0][0]
            );

            assert.equal(rows[0].column2, 1, 'Column2 value incorrect');
        });

        it('Delete', async () => {
            const [, meta] = await db.query(
                `DELETE FROM ${db.escapeId(test_table)} WHERE ${db.escapeId('column1')} = ?`,
                values[0][0]
            );

            assert.equal(meta.affectedRows, 1, 'Affected rows value incorrect');
        });

        it('Update', async () => {
            await db.query(
                `UPDATE ${db.escapeId(test_table)} SET ${db.escapeId('column2')} = ? ` +
                `WHERE ${db.escapeId('column1')} = ?`,
                5, values[1][0]
            );

            const [rows] = await db.query<{ column1: string, column2: number }>(
                `SELECT * FROM ${db.escapeId(test_table)} WHERE ${db.escapeId('column1')} = ?`,
                values[1][0]
            );

            assert.equal(rows[0].column2, 5, 'Column2 value incorrect');
        });

        it('Truncate', async () => {
            const [pre_rows] = await db.query(`SELECT * FROM ${db.escapeId(test_table)}`);

            await db.truncate(test_table);

            const [post_rows] = await db.query(`SELECT * FROM ${db.escapeId(test_table)}`);

            assert.notEqual(pre_rows.length, post_rows.length);
            assert.equal(post_rows.length, 0);
        });
    });
};
