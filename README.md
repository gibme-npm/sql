# Simple SQL Helpers for MySQL, MariaDB, SQLite, & Postgres

## Documentation

[https://gibme-npm.github.io/sql/](https://gibme-npm.github.io/sql/)

## Sample Code

### MySQL

```typescript
import MySQL from "@gibme/sql/mysql";

(async () => {
    const client = new MySQL({
       host: 'localhost',
       port: 3306,
       user: 'someuser',
       password: 'somepassword',
       database: 'somedatabase' 
    });
    
    await client.createTable('test', 
        [{
            name: 'column1',
            type: 'varchar(255)'
        },{
            name: 'column2',
            type: 'float'
        }],
        ['column1']);
    
    await client.multiInsert('test',
        ['column1', 'column2'],
        [
            ['test', 10 ],
            ['some', 20 ],
            ['values', 30]
        ]);
    
    const [rows, meta] = await client.query<{
        column1: string,
        column2: number
    }>('SELECT * FROM test');
    
    console.log(meta, rows);
})()
```

### MySQL

There are slight differences in how some statements are handled for MariaDB

```typescript
import MariaDB from "@gibme/sql/mariadb";

(async () => {
    const client = new MariaDB({
       host: 'localhost',
       port: 3306,
       user: 'someuser',
       password: 'somepassword',
       database: 'somedatabase' 
    });
    
    await client.createTable('test', 
        [{
            name: 'column1',
            type: 'varchar(255)'
        },{
            name: 'column2',
            type: 'float'
        }],
        ['column1']);
    
    await client.multiInsert('test',
        ['column1', 'column2'],
        [
            ['test', 10 ],
            ['some', 20 ],
            ['values', 30]
        ]);
    
    const [rows, meta] = await client.query<{
        column1: string,
        column2: number
    }>('SELECT * FROM test');
    
    console.log(meta, rows);
})()
```

### Postgres

```typescript
import Postgres from "@gibme/sql/postgres";

(async () => {
    const client = new Postgres({
       host: 'localhost',
       port: 5432,
       user: 'someuser',
       password: 'somepassword',
       database: 'somedatabase' 
    });
    
    await client.createTable('test', 
        [{
            name: 'column1',
            type: 'varchar(255)'
        },{
            name: 'column2',
            type: 'float'
        }],
        ['column1']);
    
    await client.multiInsert('test',
        ['column1', 'column2'],
        [
            ['test', 10 ],
            ['some', 20 ],
            ['values', 30]
        ]);
    
    const [rows, meta] = await client.query<{
        column1: string,
        column2: number
    }>('SELECT * FROM test');
    
    console.log(meta, rows);
})()
```

### SQLite

```typescript
import SQLite from "@gibme/sql/sqlite";

(async () => {
    const client = new SQLite({
        filename: ':memory:'
    });
    
    await client.createTable('test', 
        [{
            name: 'column1',
            type: 'varchar(255)'
        },{
            name: 'column2',
            type: 'float'
        }],
        ['column1']);
    
    await client.multiInsert('test',
        ['column1', 'column2'],
        [
            ['test', 10 ],
            ['some', 20 ],
            ['values', 30]
        ]);
    
    const [rows, meta] = await client.query<{
        column1: string,
        column2: number
    }>('SELECT * FROM test');
    
    console.log(meta, rows);
})()
```
