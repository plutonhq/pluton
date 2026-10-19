import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleDatabases, reorderLifecycleDatabase, remoteLifecycleValidation } from '../src/utils/remoteLifecycle.ts';

const database = {
   engine: 'mariadb' as const,
   host: 'localhost',
   port: 3306,
   tls: 'local' as const,
   database: 'example_db',
   username: 'backup_reader',
   dumpFilename: 'app.sql',
   timeoutSeconds: 60,
   maxDumpBytes: 1024 ** 3,
   includeRoutines: false,
   includeEvents: false,
};
test('existing plans have no new required lifecycle configuration', () => assert.equal(remoteLifecycleValidation(), undefined));
test('saved secret is retained without displaying/filling a password', () => {
   assert.equal(remoteLifecycleValidation({ version: 1, database: { ...database, passwordConfigured: true } }), undefined);
   assert.ok(remoteLifecycleValidation({ version: 1, database }));
});
test('valid declarative database and deployed hooks are accepted', () =>
   assert.equal(
      remoteLifecycleValidation({
         version: 1,
         database: { ...database, password: 'synthetic-test-password' },
         preHook: { id: 'prepare-app', args: ['app-01'], timeoutSeconds: 30 },
      }),
      undefined,
   ));
test('dangerous paths/shell syntax and nonlocal plaintext DB do not pass UI validation', () => {
   for (const patch of [{ dumpFilename: '../escape.sql' }, { host: 'db.example.internal' }])
      assert.ok(remoteLifecycleValidation({ version: 1, database: { ...database, passwordConfigured: true, ...patch } }));
   for (const arg of ['--command', '$(id)', '../escape'])
      assert.ok(remoteLifecycleValidation({ version: 1, preHook: { id: 'prepare', args: [arg], timeoutSeconds: 30 } }));
});

test('old single database renders as one entry and saved passwords remain absent', () => {
   const entries = lifecycleDatabases({ version: 1, database: { ...database, passwordConfigured: true } });
   assert.equal(entries.length, 1);
   assert.equal(entries[0].password, undefined);
});
test('mixed engines and reorder preserve entry identity and write-only unsaved password association', () => {
   const first = { ...database, databaseId: 'db_one', passwordConfigured: true };
   const second = {
      ...database,
      databaseId: 'db_two',
      engine: 'postgresql' as const,
      port: 5432,
      database: 'analytics',
      dumpFilename: 'analytics.sql',
      password: 'synthetic-pg-password',
   };
   const value = { version: 2 as const, databases: [first, second] };
   assert.equal(remoteLifecycleValidation(value), undefined);
   const reordered = reorderLifecycleDatabase(value, 0, 1);
   assert.deepEqual(reordered.databases, [second, first]);
   assert.equal(reordered.databases![1].password, undefined);
   assert.equal(reordered.databases![0].databaseId, 'db_two');
});
test('multi-database UI rejects duplicate identities, case collisions, unsafe PostgreSQL and too many entries', () => {
   for (const databases of [
      [
         { ...database, passwordConfigured: true },
         { ...database, dumpFilename: 'APP.sql', passwordConfigured: true },
      ],
      [
         { ...database, databaseId: 'db_one', passwordConfigured: true },
         { ...database, databaseId: 'db_one', dumpFilename: 'other.sql', passwordConfigured: true },
      ],
      [{ ...database, passwordConfigured: true, dumpFilename: '-bad.sql' }],
      [{ ...database, engine: 'postgresql' as const, password: 'synthetic\nsecret' }],
      Array.from({ length: 9 }, (_, i) => ({ ...database, dumpFilename: `db${i}.sql`, passwordConfigured: true })),
   ])
      assert.ok(remoteLifecycleValidation({ version: 2, databases }));
});
