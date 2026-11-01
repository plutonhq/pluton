import { RcloneLsJsonOutput } from '../../types/rclone';
import { SnapShotFile } from '../../types/restic';
import { SnapshotIndexEntry, SnapshotIndexSource } from '../../types/snapshotIndex';
import { parseResticMtime, toResticPath, trimTrailingSlashes } from '../restic/helpers';

export function processRcloneResponse(res: string) {
	// console.log('[RCLONE_RESPONSE] :', res);
	const syncResArray = res
		.split(/\r?\n/)
		.filter(line => line.trim() !== '')
		.map(item => JSON.parse(item));
	return syncResArray;
}

export const parseRcloneFilesList = (
	sourceFiles: RcloneLsJsonOutput[],
	srcPath: string,
	raw: boolean = false
) => {
	let latestFileDate = new Date().toISOString();
	const filesList: SnapShotFile[] = [];
	const getSrcRootFolder = srcPath.split('/').pop() || '';
	const initPath = raw ? '/' + getSrcRootFolder : toResticPath(srcPath);

	sourceFiles.forEach((item: RcloneLsJsonOutput) => {
		const theFile: SnapShotFile = {
			name: item.Name,
			path: initPath + '/' + item.Path,
			srcPath: srcPath + '/' + item.Path,
			type: item.IsDir ? 'dir' : 'file',
			isDirectory: item.IsDir || false,
			size: item.Size,
			modifiedAt: item.ModTime,
			owner: '',
			permissions: '',
			isAvailable: true,
		};

		if (item.changeType) theFile.changeType = item.changeType;

		if (latestFileDate < theFile.modifiedAt) latestFileDate = theFile.modifiedAt;
		filesList.push(theFile);
	});

	const dirs = initPath.split('/');
	dirs.forEach((pathString, index) => {
		if (pathString) {
			const parentPath = dirs.slice(0, index).join('/');
			const dirPath = parentPath + '/' + pathString;
			const pathExistInList = filesList.find(item => item.path === dirPath);
			if (!pathExistInList) {
				const parentDir = {
					name: pathString,
					path: dirPath,
					srcPath: srcPath + '/' + pathString,
					type: 'dir',
					isDirectory: true,
					isAvailable: true,
					size: 0,
					modifiedAt: latestFileDate,
					owner: '',
					permissions: '',
				};
				filesList.push(parentDir);
			}
		}
	});

	return filesList;
};

/**
 * Parses `rclone lsjson`, which prints one object per line inside a JSON array.
 * A `srcPath` line comes first for each source, because item paths are relative to it.
 */
export function createRcloneLineParser(sources: SnapshotIndexSource[]) {
	let root = '';
	return (line: string): SnapshotIndexEntry | null => {
		if (line === '[' || line === ']') {
			return null;
		}
		const item = JSON.parse(line.endsWith(',') ? line.slice(0, -1) : line);
		if (typeof item?.srcPath === 'string') {
			root = trimTrailingSlashes(toResticPath(item.srcPath));
			sources.push({ root, srcPath: item.srcPath });
			// An empty source has no lines, and its folder must still exist.
			return root ? { path: root, type: 'dir', size: 0, mtime: null, perm: null } : null;
		}
		if (typeof item?.Path !== 'string' || !item.Path) {
			return null;
		}
		return {
			path: `${root}/${item.Path}`,
			type: item.IsDir ? 'dir' : 'file',
			// rclone gives a directory a size of 0 or -1.
			size: item.IsDir ? 0 : item.Size || 0,
			mtime: parseResticMtime(item.ModTime),
			perm: null,
		};
	};
}
