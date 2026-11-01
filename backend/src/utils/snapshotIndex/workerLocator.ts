import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Returns the arguments of new Worker() for the bundle, dist or a source run.
 * `self` is the path of the calling module. `source` is relative to it, with no extension.
 */
export function locateWorker(
	self: string,
	bundledName: string,
	source: string
): { filename: string; eval?: boolean } {
	const here = path.dirname(self);
	const bundled = path.join(here, bundledName);
	if (existsSync(bundled)) {
		return { filename: bundled };
	}
	const extension = path.extname(self);
	const file = path.join(here, `${source}${extension}`);
	if (extension !== '.ts') {
		return { filename: file };
	}
	// The tsx hooks of the main thread do not reach a Worker, so it registers its own.
	const tsx = pathToFileURL(createRequire(self).resolve('tsx/esm/api')).href;
	const worker = pathToFileURL(file).href;
	return {
		filename: `import(${JSON.stringify(tsx)}).then(({ register }) => {
			register();
			return import(${JSON.stringify(worker)});
		})`,
		eval: true,
	};
}

export function getSnapshotIndexWorker() {
	return locateWorker(
		fileURLToPath(import.meta.url),
		'snapshot-index-worker.cjs',
		'../../workers/snapshotIndexWorker'
	);
}
