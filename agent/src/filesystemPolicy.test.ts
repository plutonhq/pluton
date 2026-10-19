import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises';
import { assertPathWithinAllowedRoots, resolveAllowedRoots } from './filesystemPolicy.js';

test('accepts a path inside a realpath-resolved allowed root', async () => {
	const temp = await mkdtemp(path.join(os.tmpdir(), 'pluton-agent-policy-'));
	const root = path.join(temp, 'allowed');
	const nested = path.join(root, 'nested');
	await mkdir(nested, { recursive: true });
	assert.equal(await assertPathWithinAllowedRoots(nested, [root]), await realpath(nested));
	assert.deepEqual(await resolveAllowedRoots([root]), [await realpath(root)]);
});

test('rejects traversal, sibling prefix, and non-absolute paths', async () => {
	const temp = await mkdtemp(path.join(os.tmpdir(), 'pluton-agent-policy-'));
	const root = path.join(temp, 'allowed');
	const sibling = path.join(temp, 'allowed-other');
	await mkdir(root);
	await mkdir(sibling);
	await assert.rejects(() => assertPathWithinAllowedRoots(`${root}${path.sep}..${path.sep}allowed-other`, [root]), /traversal/);
	await assert.rejects(() => assertPathWithinAllowedRoots(sibling, [root]), /outside/);
	await assert.rejects(() => assertPathWithinAllowedRoots('relative/path', [root]), /absolute/);
});

test('rejects a symlink escape', async t => {
	const temp = await mkdtemp(path.join(os.tmpdir(), 'pluton-agent-policy-'));
	const root = path.join(temp, 'allowed');
	const outside = path.join(temp, 'outside');
	const escape = path.join(root, 'escape');
	await mkdir(root);
	await mkdir(outside);
	try {
		await symlink(outside, escape, 'junction');
	} catch {
		t.skip('This platform cannot create a test symlink without additional privileges.');
		return;
	}
	await assert.rejects(() => assertPathWithinAllowedRoots(escape, [root]), /outside/);
});
