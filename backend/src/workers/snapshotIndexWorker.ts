import { parentPort, workerData } from 'worker_threads';
import { SnapshotIndexSource } from '../types/snapshotIndex';
import { createRcloneLineParser } from '../utils/rclone/parsers';
import { parseResticLine } from '../utils/restic/helpers';
import { SnapshotIndexWriter } from '../utils/snapshotIndex/SnapshotIndexWriter';

const NEWLINE = 10;
const MAX_LINE_BYTES = 1024 * 1024;

const port = parentPort!;
const writer = new SnapshotIndexWriter(workerData.filePath, workerData.meta);
const sources: SnapshotIndexSource[] = [];
const parseLine = workerData.format === 'rclone' ? createRcloneLineParser(sources) : parseResticLine;

let tail: Buffer = Buffer.alloc(0);
let lines = 0;

function addLine(buffer: Buffer, start: number, end: number) {
	const line = buffer.toString('utf8', start, end).trim();
	if (!line) {
		return;
	}
	lines++;
	const entry = parseLine(line);
	if (entry) {
		writer.add(entry);
	}
}

function addChunk(chunk: Buffer) {
	const buffer = tail.length ? Buffer.concat([tail, chunk]) : chunk;
	let start = 0;
	let end = buffer.indexOf(NEWLINE);
	while (end !== -1) {
		addLine(buffer, start, end);
		start = end + 1;
		end = buffer.indexOf(NEWLINE, start);
	}
	tail = buffer.subarray(start);
	if (tail.length > MAX_LINE_BYTES) {
		throw Object.assign(new Error('The file list has a line that is too long'), {
			code: 'integrity',
		});
	}
}

port.on('message', message => {
	try {
		if (message.type === 'chunk') {
			addChunk(Buffer.from(message.data.buffer, message.data.byteOffset, message.data.byteLength));
			port.postMessage({ type: 'ack', lines });
			return;
		}
		addLine(tail, 0, tail.length);
		const stats = writer.finish(message.snapshotId, sources);
		port.postMessage({ type: 'done', lines, stats });
	} catch (error: any) {
		writer.abort();
		port.postMessage({ type: 'error', code: error?.code, message: error?.message || String(error) });
	}
});
