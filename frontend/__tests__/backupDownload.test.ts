import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupRowActions, startNativeBackupDownload } from '../src/utils/backupDownload.ts';

const completed = { status: 'completed', active: true, inProgress: false, success: true };
test('completed remote menu exposes Download/Browse/Restore, never Remove', () => {
   assert.deepEqual(backupRowActions(completed, false, true), { download: true, browse: true, restore: true, remove: false });
});
for (const status of ['failed', 'started', 'pending', 'cancelled', 'retrying']) {
   test(`remote ${status} rows do not expose Download`, () => {
      assert.equal(backupRowActions({ ...completed, status }, false, true).download, false);
   });
}
test('incomplete/unsuccessful/inactive remote rows do not expose Download', () => {
   for (const state of [{ inProgress: true }, { success: false }, { active: false }])
      assert.equal(backupRowActions({ ...completed, ...state }, false, true).download, false);
});
test('existing local and sync menu behavior stays intact', () => {
   assert.deepEqual(backupRowActions(completed, false, false), { download: true, browse: true, restore: true, remove: true });
   assert.deepEqual(backupRowActions(completed, true, false), { download: false, browse: false, restore: true, remove: true });
   assert.equal(backupRowActions({ ...completed, status: 'failed' }, false, false).remove, true);
});
function documentFixture(click: () => void) {
   const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
   const events: string[] = [];
   const anchor = {
      href: '',
      download: undefined as string | undefined,
      click() {
         events.push('click');
         click();
      },
      remove() {
         events.push('remove');
      },
   };
   Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
         createElement(name: string) {
            assert.equal(name, 'a');
            return anchor;
         },
         body: {
            appendChild(element: unknown) {
               assert.equal(element, anchor);
               events.push('append');
            },
         },
      },
   });
   return {
      anchor,
      events,
      cleanup() {
         if (previous) Object.defineProperty(globalThis, 'document', previous);
         else Reflect.deleteProperty(globalThis, 'document');
      },
   };
}
test('native download sends only the encoded backup identifier and avoids fetch/blob buffering', () => {
   const fixture = documentFixture(() => {});
   const previous = globalThis.fetch;
   globalThis.fetch = () => {
      throw new Error('Archive must not be buffered with fetch');
   };
   try {
      startNativeBackupDownload('https://example.internal/api', 'backup-01/unsafe?value');
      assert.equal(fixture.anchor.href, 'https://example.internal/api/backups/backup-01%2Funsafe%3Fvalue/action/download');
      assert.equal(fixture.anchor.download, '');
      assert.deepEqual(fixture.events, ['append', 'click', 'remove']);
   } finally {
      globalThis.fetch = previous;
      fixture.cleanup();
   }
});
test('temporary browser anchor is removed even if download initiation fails', () => {
   const fixture = documentFixture(() => {
      throw new Error('Synthetic browser failure');
   });
   try {
      assert.throws(() => startNativeBackupDownload('/api', 'backup-01'));
      assert.deepEqual(fixture.events, ['append', 'click', 'remove']);
   } finally {
      fixture.cleanup();
   }
});
