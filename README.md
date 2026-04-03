# Simple SQL Helpers for MySQL, MariaDB, SQLite, & Postgres

A TypeScript database abstraction library providing a unified interface for MySQL, MariaDB, PostgreSQL, and SQLite. It wraps driver-specific behavior behind a common abstract `Database` class so consumers use the same API regardless of backend.

**Node >= 22 required.**

## Documentation

[https://gibme-npm.github.io/sql/](https://gibme-npm.github.io/sql/)

## Installation

```bash
yarn add @gibme/sql
```

## Quick Start

### Factory Function

Use `createConnection()` to instantiate the correct driver based on `Database.Type`:

```typescript
import { createConnection, Database } from '@gibme/sql';

const client = createConnection(Database.Type.SQLITE, {
    filename: ':memory:'
});

await client.createTable('test', [
    { name: 'id', type: 'integer' },
    { name: 'value', type: 'varchar(255)' }
], ['id']);

const [rows, meta] = await client.query('SELECT * FROM test');
```

When no arguments are provided, `createConnection()` reads from environment variables (see [Environment Variables](#environment-variables) below) and defaults to an in-memory SQLite database.

### Direct Imports

Import specific drivers directly to avoid bundling unused drivers:

```typescript
import MySQL from '@gibme/sql/mysql';
import MariaDB from '@gibme/sql/mariadb';
import Postgres from '@gibme/sql/postgres';
import SQLite from '@gibme/sql/sqlite';
import { Database } from '@gibme/sql/database';
```

## Driver Configuration

### MySQL

```typescript
import MySQL from '@gibme/sql/mysql';

const client = new MySQL({
    host: 'localhost',       // default: '127.0.0.1'
    port: 3306,              // default: 3306
    user: 'someuser',        // default: ''
    password: 'somepassword',
    database: 'somedatabase',
    connectTimeout: 30_000,  // default: 30000 ms
    useSSL: false,           // default: false
    rejectUnauthorized: false // default: false
});
```

The MySQL driver accepts all [`mariadb.PoolConfig`](https://github.com/mariadb-corporation/mariadb-connector-nodejs) options in addition to the ones listed above.

The second constructor argument accepts a table options string used when creating tables (default: `'ENGINE=InnoDB PACK_KEYS=1 ROW_FORMAT=COMPRESSED'`).

### MariaDB

MariaDB extends the MySQL driver and accepts the same configuration. The only difference is the UPSERT dialect used internally.

```typescript
import MariaDB from '@gibme/sql/mariadb';

const client = new MariaDB({
    host: 'localhost',
    port: 3306,
    user: 'someuser',
    password: 'somepassword',
    database: 'somedatabase'
});
```

### Postgres

```typescript
import Postgres from '@gibme/sql/postgres';

const client = new Postgres({
    host: 'localhost',       // default: '127.0.0.1'
    port: 5432,              // default: 5432
    user: 'someuser',        // default: ''
    password: 'somepassword',
    database: 'somedatabase',
    ssl: false,              // default: false
    rejectUnauthorized: false // default: false
});
```

The Postgres driver accepts all [`pg.PoolConfig`](https://node-postgres.com/) options in addition to the ones listed above.

### SQLite

```typescript
import SQLite from '@gibme/sql/sqlite';

const client = new SQLite({
    filename: './data.db', // default: ':memory:'
    readonly: false,       // default: false
    foreignKeys: true,     // default: true (enables PRAGMA foreign_keys)
    WALmode: true          // default: true (enables PRAGMA journal_mode=WAL)
});
```

SQLite instances are managed as singletons per filename, so multiple `SQLite` instances pointing to the same file share the underlying connection. All operations are serialized through a mutex for thread safety.

#### PRAGMA Support

Read and set PRAGMA values on SQLite connections:

```typescript
const walMode = await client.getPragma('journal_mode');
await client.setPragma('foreign_keys', true);
```

The following PRAGMAs are supported through the dedicated methods: `quick_check`, `integrity_check`, `incremental_vacuum`, `foreign_key_check`, `foreign_key_list`, `index_info`, `index_list`, `index_xinfo`, `table_info`, `table_xinfo`, and `optimize`. Other PRAGMAs can be executed directly via `query()`.

## Query Results

All queries return a `[rows, metadata, query]` tuple:

```typescript
const [rows, meta, query] = await client.query<{
    column1: string,
    column2: number
}>('SELECT * FROM test WHERE column1 = ?', 'value');

// rows  - RecordType[] array of result rows
// meta  - { changedRows, affectedRows, insertId?, length }
// query - { query, values? } the executed query
```

Query parameters use `?` placeholders across all drivers. The Postgres driver automatically converts these to `$1, $2, ...` numbered parameters internally.

## Table Management

### Creating Tables

```typescript
await client.createTable('users', [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'name', type: 'varchar(255)' },
    { name: 'email', type: 'varchar(255)', unique: true },
    { name: 'role', type: 'varchar(50)', default: 'user' },
    { name: 'score', type: 'float', nullable: true }
], ['id']); // primary key columns
```

Tables are created with `IF NOT EXISTS`. Columns marked `unique: true` automatically get a unique index.

#### Column Options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Column name |
| `type` | `string` | required | SQL type (e.g., `varchar(255)`, `integer`, `float`) |
| `nullable` | `boolean` | `true` | Whether the column allows NULL values |
| `default` | `string \| number \| boolean` | — | Default value for the column |
| `unique` | `boolean` | `false` | Creates a unique index on this column |
| `foreignKey` | `ForeignKey` | — | Foreign key relationship (see below) |

Column types are validated against the pattern `/^[a-zA-Z][a-zA-Z0-9 (),]*$/`.

### Foreign Key Constraints

```typescript
await client.createTable('orders', [
    { name: 'id', type: 'integer' },
    {
        name: 'user_id',
        type: 'integer',
        foreignKey: {
            table: 'users',
            column: 'id',
            onDelete: Database.Table.ForeignKeyConstraint.CASCADE,
            onUpdate: Database.Table.ForeignKeyConstraint.CASCADE
        }
    }
], ['id']);
```

Available constraints: `RESTRICT`, `CASCADE`, `NULL` (SET NULL), `DEFAULT` (SET DEFAULT), `NA` (NO ACTION).

### Indexes

```typescript
// Standard index
await client.createIndex('users', ['email']);

// Unique index
await client.createIndex('users', ['email'], Database.Table.IndexType.UNIQUE);
```

### Other Table Operations

```typescript
// List all tables
const tables = await client.listTables();

// Drop tables
await client.dropTable('users');
await client.dropTable(['temp1', 'temp2']);

// Truncate tables
await client.truncate('users');

// Switch database (MySQL/MariaDB/Postgres)
await client.use('other_database');
```

## Transactions

All drivers support transactions via `transaction()`:

```typescript
const results = await client.transaction([
    { query: 'INSERT INTO users (name) VALUES (?)', values: ['Alice'] },
    { query: 'INSERT INTO users (name) VALUES (?)', values: ['Bob'] }
]);

// results is an array of [rows, metadata, query] tuples, one per query
```

Set `noError: true` on individual queries to ignore their failures without aborting the transaction (MySQL/MariaDB/Postgres only — SQLite transactions are atomic and roll back entirely on any failure).

```typescript
await client.transaction([
    { query: 'INSERT INTO users (name) VALUES (?)', values: ['Alice'] },
    { query: 'INSERT INTO users (name) VALUES (?)', values: ['duplicate'], noError: true },
    { query: 'INSERT INTO users (name) VALUES (?)', values: ['Charlie'] }
]);
```

## Bulk Operations

### Bulk Insert

```typescript
await client.multiInsert('test', ['col1', 'col2'], [
    ['a', 1],
    ['b', 2],
    ['c', 3]
]);
```

### Bulk Upsert

Insert rows or update them if they conflict on the primary key:

```typescript
await client.multiUpdate('test', ['col1'], ['col1', 'col2'], [
    ['a', 10],  // updates existing row
    ['d', 40]   // inserts new row
]);
```

Both operations accept an optional `useTransaction` parameter (default: `true`) to control whether the bulk operation is wrapped in a transaction.

### Prepared Queries

Generate query objects without executing them, useful for combining with other operations or inspecting the generated SQL:

```typescript
const queries = client.prepareMultiInsert('test', ['col1', 'col2'], [
    ['a', 1],
    ['b', 2]
]);

const createQueries = client.prepareCreateTable('test', [
    { name: 'id', type: 'integer' }
], ['id']);
```

## Connection Pool

MySQL/MariaDB use the `mariadb` driver's native connection pool. PostgreSQL uses `pg`'s pool. SQLite uses a singleton instance with mutex-based concurrency.

Monitor pool status via getters:

```typescript
console.log(client.idleConnections); // connections available in pool
console.log(client.totalConnections); // total pool size
```

## Events

The `Database` class extends `EventEmitter`. Available events vary by driver:

**MySQL / MariaDB:**

| Event | Description |
|---|---|
| `error` | Connection error |
| `acquire` | Connection acquired from pool |
| `connection` | New connection created |
| `enqueue` | Connection request queued (pool exhausted) |
| `release` | Connection released back to pool |

**Postgres:**

| Event | Description |
|---|---|
| `connect` | New connection created |
| `acquire` | Connection acquired from pool |
| `remove` | Connection removed from pool |
| `error` | Connection error |

```typescript
client.on('error', (err) => {
    console.error('Database connection error:', err);
});
```

## Utility Methods

```typescript
// Escape a string value for safe SQL interpolation
const safe = client.escape(userInput);

// Escape an identifier (table/column name)
const id = client.escapeId('column name');

// Check the driver type
if (client.type === Database.Type.POSTGRES) { /* ... */ }
console.log(client.typeName); // 'MySQL', 'MariaDB', 'Postgres', or 'SQLite'
```

Escaping is driver-aware: Postgres uses `pg-format`, all others use `sqlstring`.

## TLS / SSL

MySQL/MariaDB and Postgres disable TLS certificate validation by default (`rejectUnauthorized: false`) for development convenience. Set `rejectUnauthorized: true` in production:

```typescript
// MySQL/MariaDB
const client = new MySQL({
    host: 'prod-host',
    useSSL: true,
    rejectUnauthorized: true
});

// Postgres
const client = new Postgres({
    host: 'prod-host',
    ssl: true,
    rejectUnauthorized: true
});
```

## Environment Variables

`createConnection()` reads these environment variables when options are not provided directly:

| Variable | Description | Default |
|---|---|---|
| `SQL_TYPE` | Database type enum value (`0`=MySQL, `1`=Postgres, `2`=SQLite, `4`=MariaDB) | `2` (SQLite) |
| `SQL_HOST` | Database host | `127.0.0.1` |
| `SQL_PORT` | Database port | Driver default |
| `SQL_USERNAME` | Database user | `''` |
| `SQL_PASSWORD` | Database password | |
| `SQL_DATABASE` | Database name | |
| `SQL_SSL` | Enable SSL (`true`/`false`) | `false` |
| `SQL_FILENAME` | SQLite database file path | `:memory:` |

A `.env` file is loaded automatically via `dotenv`.

## Type Reference

```typescript
// Database type enum
enum Database.Type {
    MYSQL = 0,
    POSTGRES = 1,
    SQLITE = 2,
    MARIADB = 4
}

// Query result tuple
type Database.Query.Result<T> = [T[], Database.Query.MetaData, Database.Query]

// Query metadata
type Database.Query.MetaData = {
    changedRows: number;
    affectedRows: number;
    insertId?: number;
    length: number;
}

// Query definition (for transactions and prepared queries)
type Database.Query = {
    query: string;
    values?: any[];
    noError?: boolean;
}

// Column definition
type Database.Table.Column = {
    name: string;
    type: string;
    nullable?: boolean;
    default?: string | number | boolean;
    unique?: boolean;
    foreignKey?: Database.Table.ForeignKey;
}

// Foreign key definition
type Database.Table.ForeignKey = {
    table: string;
    column: string;
    onUpdate?: Database.Table.ForeignKeyConstraint;
    onDelete?: Database.Table.ForeignKeyConstraint;
}

// Foreign key constraint actions
enum Database.Table.ForeignKeyConstraint {
    RESTRICT = 'RESTRICT',
    CASCADE = 'CASCADE',
    NULL = 'SET NULL',
    DEFAULT = 'SET DEFAULT',
    NA = 'NO ACTION'
}

// Index types
enum Database.Table.IndexType {
    NONE = '',
    UNIQUE = 'UNIQUE'
}
```

## Known Limitations

- **Postgres `?` placeholders**: The library automatically converts `?` placeholders to `$1, $2, ...` for Postgres. This conflicts with PostgreSQL JSON operators (`?`, `?|`, `?&`). Use the native `$1, $2` syntax directly for queries involving JSON operators.

- **SQLite transaction atomicity**: SQLite transactions use `better-sqlite3`'s native `transaction()` callback, which is all-or-nothing. Individual query `noError` flags cannot be honored per-query — if any query fails, the entire transaction rolls back.

- **Column type validation**: Column types in `createTable` are validated against the pattern `/^[a-zA-Z][a-zA-Z0-9 (),]*$/`. Types must start with a letter and can only contain letters, digits, spaces, parentheses, and commas.
