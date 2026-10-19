#!/usr/local/bin/node
import { basename, dirname, join } from 'node:path';
import { appendFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
const name = basename(process.argv[1]);
if (process.env.RESTIC_PASSWORD || process.env.RCLONE_CONFIG || process.env.MYSQL_PWD || process.env.SECRET) process.exit(30);
appendFileSync(join(dirname(dirname(process.cwd())), 'hook-calls'), JSON.stringify({ name, workspace: process.cwd(), args: process.argv.slice(2) }) + '\n');
if (name === 'fail') { console.error('test-only-db-secret private hook diagnostic'); process.exitCode = 1; }
if (name === 'slow') setInterval(() => {}, 1000);
if (name === 'noisy') process.stdout.write('x'.repeat(100000));
if (name === 'dirty') {
  const directory = join(process.cwd(), 'cleanup-test'); mkdirSync(directory); writeFileSync(join(directory, 'example.txt'), 'synthetic'); chmodSync(directory, 0);
}
if (name === 'child') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  appendFileSync(join(dirname(dirname(process.cwd())), 'child-pid'), String(child.pid));
  child.unref(); setInterval(() => {}, 1000);
}
