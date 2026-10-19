import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { createTemporaryId } from '../src/utils/temporaryId.ts';

function withCrypto(value: unknown, run: () => void) {
   const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
   Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
   try {
      run();
   } finally {
      if (previous) Object.defineProperty(globalThis, 'crypto', previous);
      else Reflect.deleteProperty(globalThis, 'crypto');
   }
}

test('temporary UI IDs prefer randomUUID when available and preserve the Crypto receiver', () => {
   const crypto = {
      randomUUID() {
         assert.equal(this, crypto);
         return '00000000-0000-4000-8000-000000000001';
      },
      getRandomValues() {
         assert.fail('The fallback must not run when randomUUID is available.');
      },
   };
   withCrypto(crypto, () => assert.equal(createTemporaryId(), 'ui-00000000-0000-4000-8000-000000000001'));
});

test('HTTP-style Crypto without randomUUID generates 128-bit temporary IDs with getRandomValues', (t) => {
   t.mock.method(Math, 'random', () => assert.fail('Math.random must not be used.'));
   const crypto = {
      getRandomValues(bytes: Uint8Array) {
         assert.equal(this, crypto);
         assert.equal(bytes.length, 16);
         bytes.set(Array.from({ length: 16 }, (_, index) => index));
         return bytes;
      },
   };
   withCrypto(crypto, () => assert.equal(createTemporaryId(), 'ui-000102030405060708090a0b0c0d0e0f'));
});

test('an unavailable or non-callable randomUUID falls back without throwing', () => {
   for (const randomUUID of [undefined, null, 'unavailable']) {
      withCrypto({ randomUUID, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, () => {
         assert.match(createTemporaryId(), /^ui-[a-f0-9]{32}$/);
      });
   }
});

test('getRandomValues produces distinct client-only keys without the persisted db_ prefix', () => {
   withCrypto({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, () => {
      const ids = Array.from({ length: 1024 }, () => createTemporaryId());
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.every((id) => /^ui-[a-f0-9]{32}$/.test(id)));
   });
});

test('non-browser runtimes without Crypto still get distinct session keys, not security IDs', (t) => {
   t.mock.method(Math, 'random', () => assert.fail('Math.random must not be used.'));
   t.mock.method(Date, 'now', () => 1_700_000_000_000);
   withCrypto(undefined, () => {
      const ids = Array.from({ length: 8 }, () => createTemporaryId());
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(ids.every((id) => id.startsWith('ui-') && !id.startsWith('db_')));
   });
});
