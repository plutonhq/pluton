import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIdentity } from '../src/utils/buildIdentity.ts';
test('local build identity does not fabricate semantic release or vmain', () => {
   assert.equal(buildIdentity('0.18.0-alpha.1'), 'v0.18.0-alpha.1');
   assert.equal(buildIdentity('main', 'a'.repeat(40)), 'Development build · main · aaaaaaaaaaaa');
   assert.equal(buildIdentity('unknown'), 'Development build');
   assert.equal(buildIdentity('pr-99'), 'Development build · pr-99');
});
test('footer only links local docs/changelog/about and ignores old commercial props', () => {
   const footer = readFileSync(new URL('../src/components/App/Footer/Footer.tsx', import.meta.url), 'utf8');
   for (const link of ['/docs', '/docs/changelog', '/docs/reference/acknowledgements']) assert(footer.includes(`href="${link}"`));
   assert(!/usepluton\.com|Update Available|<Upgrade|useCheckLatestVersion/.test(footer));
   const router = readFileSync(new URL('../src/router.tsx', import.meta.url), 'utf8');
   assert(!router.includes('useCheckLatestVersion'));
   assert(router.includes('/docs/*'));
});
