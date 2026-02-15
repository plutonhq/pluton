import { RcloneLsJsonOutput } from '../../types/rclone';
import { SnapShotFile } from '../../types/restic';
import { toResticPath } from '../restic/helpers';

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
