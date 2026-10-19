import fs from 'fs/promises';
import { constants } from 'fs';
import type { RecoveryEngine } from '../types/recoveryTests';
import { RecoveryTestError } from './recoveryValidation';

const incompatible = () =>
	new RecoveryTestError('database-target-preflight', 'database-client-incompatible');
const version = (text: string) => /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?(?:\D|$)/.exec(text);
/** Not a SQL dialect inference or rewrite. Recorded engine remains authoritative.
 * Check the real dedicated server, and reject positively identified newer/cross-engine
 * dump headers. Header-less historical SQL remains explicitly not version certified. */
export async function checkRecoveryDumpCompatibility(
	engine: RecoveryEngine,
	file: string,
	server: string
) {
	const actual = server.trim();
	const target = version(actual);
	if (
		!target ||
		actual.length > 256 ||
		/[\r\n\0]/.test(actual) ||
		(engine === 'mariadb' ? !/MariaDB/i.test(actual) : /MariaDB/i.test(actual))
	)
		throw incompatible();
	const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	let text: string;
	try {
		const head = Buffer.alloc(64 * 1024);
		const { bytesRead } = await handle.read(head, 0, head.length, 0);
		text = head.subarray(0, bytesRead).toString('utf8');
	} finally {
		await handle.close();
	}
	if (text.startsWith('PGDMP')) throw incompatible(); // plain SQL only, never invoke pg_restore
	const postgres = /^-- Dumped from database version (\d+\.\d+(?:\.\d+)?)/m.exec(text);
	const dumpedBy = /^-- Dumped by pg_dump version (\d+\.\d+(?:\.\d+)?)/m.exec(text);
	const mysql = /^-- Server version\s+(\d+\.\d+(?:\.\d+)?[^\r\n]*)/m.exec(text);
	if ((engine === 'postgresql' && mysql) || (engine !== 'postgresql' && (postgres || dumpedBy)))
		throw incompatible();
	if (mysql && (engine === 'mariadb') !== /MariaDB/i.test(mysql[1])) throw incompatible();
	const source = postgres?.[1] || mysql?.[1];
	for (const declared of [source, dumpedBy?.[1]]) {
		if (!declared) continue;
		const parsed = version(declared);
		if (
			!parsed ||
			Number(parsed[1]) > Number(target[1]) ||
			(engine !== 'postgresql' && parsed[1] === target[1] && Number(parsed[2]) > Number(target[2]))
		)
			throw incompatible();
	}
	return source ? ('header-and-target-checked' as const) : ('not-recorded' as const);
}
