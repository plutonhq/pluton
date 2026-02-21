import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PlanScript } from '../../src/types/plans';

// --- Mocks ---

const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();
const mockChild = Object.assign(new EventEmitter(), {
stdout: mockStdout,
stderr: mockStderr,
});

const mockSpawn = jest.fn().mockReturnValue(mockChild);

jest.mock('child_process', () => ({
spawn: (...args: any[]) => mockSpawn(...args),
}));

jest.mock('fs', () => ({
existsSync: jest.fn().mockReturnValue(true),
statSync: jest.fn().mockReturnValue({ isDirectory: () => false }),
}));

jest.mock('os');

import { executeUserScript, runScriptsForEvent } from '../../src/utils/executeUserScript';

// --- Helpers ---

function buildScript(overrides: Partial<PlanScript> = {}): PlanScript {
return {
id: 'script-1',
type: 'script',
enabled: true,
scriptPath: '/scripts/backup.sh',
logOutput: false,
...overrides,
};
}

function freshChild() {
const stdout = new EventEmitter();
const stderr = new EventEmitter();
const child = Object.assign(new EventEmitter(), { stdout, stderr });
mockSpawn.mockReturnValue(child);
return child;
}

// --- Tests ---

describe('executeUserScript', () => {
let isAbsoluteSpy: jest.SpyInstance;

beforeEach(() => {
jest.clearAllMocks();
isAbsoluteSpy = jest.spyOn(path, 'isAbsolute').mockReturnValue(true);
(fs.existsSync as jest.Mock).mockReturnValue(true);
(fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
(os.platform as jest.Mock).mockReturnValue('linux');
});

afterEach(() => {
isAbsoluteSpy.mockRestore();
});

// Path validation
describe('path validation', () => {
it('rejects when scriptPath is empty', async () => {
await expect(executeUserScript(buildScript({ scriptPath: '' }))).rejects.toThrow(
'Script path is empty.'
);
});

it('rejects when scriptPath is whitespace', async () => {
await expect(executeUserScript(buildScript({ scriptPath: '   ' }))).rejects.toThrow(
'Script path is empty.'
);
});

it('rejects when scriptPath contains ".." traversal', async () => {
await expect(
executeUserScript(buildScript({ scriptPath: '/scripts/../etc/passwd' }))
).rejects.toThrow('contains ".." traversal');
});

it('rejects when scriptPath is not absolute', async () => {
isAbsoluteSpy.mockReturnValue(false);
await expect(
executeUserScript(buildScript({ scriptPath: 'scripts/backup.sh' }))
).rejects.toThrow('Script path must be absolute');
});

it('rejects when script file does not exist', async () => {
(fs.existsSync as jest.Mock).mockReturnValue(false);
await expect(
executeUserScript(buildScript({ scriptPath: '/scripts/missing.sh' }))
).rejects.toThrow('Script file does not exist');
});

it('rejects when scriptPath is a directory', async () => {
(fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
await expect(
executeUserScript(buildScript({ scriptPath: '/scripts/dir/' }))
).rejects.toThrow('Script path is a directory');
});
});

// Extension-based execution
describe('extension-based execution', () => {
const extensionCases = [
{ ext: '.sh', platform: 'linux', expectedExe: '/bin/bash', scriptPath: '/scripts/backup.sh' },
{ ext: '.sh', platform: 'win32', expectedExe: 'bash', scriptPath: '/scripts/backup.sh' },
{ ext: '.bash', platform: 'linux', expectedExe: '/bin/bash', scriptPath: '/scripts/backup.bash' },
{ ext: '.ps1', platform: 'win32', expectedExe: 'powershell.exe', scriptPath: '/scripts/backup.ps1' },
{ ext: '.bat', platform: 'win32', expectedExe: 'cmd.exe', scriptPath: '/scripts/backup.bat' },
{ ext: '.cmd', platform: 'win32', expectedExe: 'cmd.exe', scriptPath: '/scripts/backup.cmd' },
{ ext: '.py', platform: 'linux', expectedExe: 'python3', scriptPath: '/scripts/backup.py' },
{ ext: '.py', platform: 'win32', expectedExe: 'python', scriptPath: '/scripts/backup.py' },
{ ext: '.rb', platform: 'linux', expectedExe: 'ruby', scriptPath: '/scripts/backup.rb' },
{ ext: '.pl', platform: 'linux', expectedExe: 'perl', scriptPath: '/scripts/backup.pl' },
{ ext: '.zsh', platform: 'linux', expectedExe: 'zsh', scriptPath: '/scripts/backup.zsh' },
];

it.each(extensionCases)(
'spawns $expectedExe for $ext on $platform',
async ({ platform, expectedExe, scriptPath: sp }) => {
(os.platform as jest.Mock).mockReturnValue(platform);
const child = freshChild();
const promise = executeUserScript(buildScript({ scriptPath: sp }));

child.emit('close', 0, null);
await promise;

expect(mockSpawn).toHaveBeenCalledWith(
expectedExe,
expect.arrayContaining([sp]),
expect.any(Object)
);
}
);

it('defaults to /bin/sh for unknown extension on Linux', async () => {
(os.platform as jest.Mock).mockReturnValue('linux');
const child = freshChild();
const promise = executeUserScript(buildScript({ scriptPath: '/scripts/backup.xyz' }));

child.emit('close', 0, null);
await promise;

expect(mockSpawn).toHaveBeenCalledWith('/bin/sh', ['/scripts/backup.xyz'], expect.any(Object));
});

it('defaults to powershell for unknown extension on Windows', async () => {
(os.platform as jest.Mock).mockReturnValue('win32');
const child = freshChild();
const promise = executeUserScript(buildScript({ scriptPath: '/scripts/backup.xyz' }));

child.emit('close', 0, null);
await promise;

expect(mockSpawn).toHaveBeenCalledWith(
'powershell.exe',
['-NoProfile', '-NonInteractive', '-File', '/scripts/backup.xyz'],
expect.any(Object)
);
});
});

// Spawn options
describe('spawn options', () => {
it('sets cwd to script directory', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript({ scriptPath: '/scripts/sub/backup.sh' }));

child.emit('close', 0, null);
await promise;

expect(mockSpawn).toHaveBeenCalledWith(
expect.any(String),
expect.any(Array),
expect.objectContaining({ cwd: path.dirname('/scripts/sub/backup.sh') })
);
});

it('sets shell to false', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript());

child.emit('close', 0, null);
await promise;

expect(mockSpawn).toHaveBeenCalledWith(
expect.any(String),
expect.any(Array),
expect.objectContaining({ shell: false })
);
});

it('passes timeout option to spawn', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript({ timeout: 3000 }));

child.emit('close', 0, null);
await promise;

expect(mockSpawn).toHaveBeenCalledWith(
expect.any(String),
expect.any(Array),
expect.objectContaining({ timeout: 3000 })
);
});
});

// Success
it('resolves with stdout and stderr on exit code 0', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript());

child.stdout.emit('data', Buffer.from('out'));
child.stderr.emit('data', Buffer.from('err'));
child.emit('close', 0, null);

const result = await promise;
expect(result).toEqual({ stdout: 'out', stderr: 'err' });
});

// Failures
it('rejects on non-zero exit code', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript());

child.stderr.emit('data', Buffer.from('bad'));
child.emit('close', 1, null);

await expect(promise).rejects.toThrow('bad');
});

it('rejects with generic message when stderr and stdout are empty', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript());

child.emit('close', 2, null);

await expect(promise).rejects.toThrow('Script exited with code 2');
});

it('rejects on SIGTERM (timeout)', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript({ timeout: 5000 }));

child.emit('close', null, 'SIGTERM');

await expect(promise).rejects.toThrow('Script timed out after 5000ms');
});

it('uses default timeout message when timeout is not set', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript());

child.emit('close', null, 'SIGTERM');

await expect(promise).rejects.toThrow('Script timed out after 60000ms');
});

it('rejects on spawn error', async () => {
const child = freshChild();
const promise = executeUserScript(buildScript());

child.emit('error', new Error('ENOENT'));

await expect(promise).rejects.toThrow('Failed to start script process: ENOENT');
});
});

describe('runScriptsForEvent', () => {
let onStart: jest.Mock;
let onComplete: jest.Mock;
let onError: jest.Mock;
let isAbsoluteSpy: jest.SpyInstance;

beforeEach(() => {
jest.clearAllMocks();
onStart = jest.fn().mockResolvedValue(undefined);
onComplete = jest.fn().mockResolvedValue(undefined);
onError = jest.fn().mockResolvedValue(undefined);
isAbsoluteSpy = jest.spyOn(path, 'isAbsolute').mockReturnValue(true);
(fs.existsSync as jest.Mock).mockReturnValue(true);
(fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
(os.platform as jest.Mock).mockReturnValue('linux');
});

afterEach(() => {
isAbsoluteSpy.mockRestore();
});

it('returns early when no scripts are provided', async () => {
await runScriptsForEvent('onBackupStart', [], onStart, onComplete, onError);

expect(onStart).not.toHaveBeenCalled();
expect(onComplete).not.toHaveBeenCalled();
expect(mockSpawn).not.toHaveBeenCalled();
});

it('returns early when eventName is empty', async () => {
await runScriptsForEvent('', [buildScript()], onStart, onComplete, onError);

expect(onStart).not.toHaveBeenCalled();
expect(mockSpawn).not.toHaveBeenCalled();
});

it('skips disabled scripts', async () => {
const scripts = [buildScript({ enabled: false })];
await runScriptsForEvent('onBackupStart', scripts, onStart, onComplete, onError);

expect(onStart).not.toHaveBeenCalled();
expect(mockSpawn).not.toHaveBeenCalled();
});

it('skips scripts with empty scriptPath', async () => {
const scripts = [buildScript({ scriptPath: '   ' })];
await runScriptsForEvent('onBackupStart', scripts, onStart, onComplete, onError);

expect(onStart).not.toHaveBeenCalled();
expect(mockSpawn).not.toHaveBeenCalled();
});

it('calls onStart and onComplete callbacks on success', async () => {
const child = freshChild();
const scripts = [buildScript()];

const promise = runScriptsForEvent('onBackupStart', scripts, onStart, onComplete, onError);

// Defer emission: runScriptsForEvent does await onStart() before calling
// executeUserScript, so the child's 'close' listener isn't set up yet.
setImmediate(() => {
child.emit('close', 0, null);
});

await promise;

expect(onStart).toHaveBeenCalledWith('ONBACKUPSTART_SCRIPT_1');
expect(onComplete).toHaveBeenCalledWith('ONBACKUPSTART_SCRIPT_1');
expect(onError).not.toHaveBeenCalled();
});

it('calls onError callback on script failure', async () => {
const child = freshChild();
const scripts = [buildScript({ abortOnError: false })];

const promise = runScriptsForEvent('onBackupStart', scripts, onStart, onComplete, onError);

setImmediate(() => {
child.stderr.emit('data', Buffer.from('something went wrong'));
child.emit('close', 1, null);
});

await promise;

expect(onStart).toHaveBeenCalledWith('ONBACKUPSTART_SCRIPT_1');
expect(onError).toHaveBeenCalledWith(
'ONBACKUPSTART_SCRIPT_1',
expect.stringContaining('something went wrong')
);
expect(onComplete).not.toHaveBeenCalled();
});

it('throws when abortOnError is true and script fails', async () => {
const child = freshChild();
const scripts = [buildScript({ abortOnError: true })];

const promise = runScriptsForEvent('onBackupStart', scripts, onStart, onComplete, onError);

setImmediate(() => {
child.stderr.emit('data', Buffer.from('fatal'));
child.emit('close', 1, null);
});

await expect(promise).rejects.toThrow("Critical 'beforeBackup' hook failed");
expect(onError).toHaveBeenCalled();
});

it('processes multiple scripts in order', async () => {
const children = [freshChild()];
const scripts = [
buildScript({ id: 's1', scriptPath: '/scripts/first.sh' }),
buildScript({ id: 's2', scriptPath: '/scripts/second.sh' }),
];

const child2 = freshChild();
let callCount = 0;
mockSpawn.mockImplementation(() => {
callCount++;
if (callCount === 1) return children[0];
return child2;
});

const promise = runScriptsForEvent('onBackupStart', scripts, onStart, onComplete, onError);

// Complete first script
setImmediate(() => {
children[0].emit('close', 0, null);
// Complete second script after first is done
setImmediate(() => {
child2.emit('close', 0, null);
});
});

await promise;

expect(onStart).toHaveBeenCalledTimes(2);
expect(onComplete).toHaveBeenCalledTimes(2);
expect(onStart).toHaveBeenNthCalledWith(1, 'ONBACKUPSTART_SCRIPT_1');
expect(onStart).toHaveBeenNthCalledWith(2, 'ONBACKUPSTART_SCRIPT_2');
});
});
