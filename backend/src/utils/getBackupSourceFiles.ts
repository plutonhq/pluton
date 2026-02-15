import { RcloneLsJsonOutput } from '../types/rclone';
import { runRcloneCommand } from './rclone/rclone';
import { parseRcloneFilesList } from './rclone/parsers';
import { SnapShotFile } from '../types/restic';

async function getBackupSourceFiles(
	sourcePaths: string[],
	rawPath: boolean = false
): Promise<{ success: boolean; result: SnapShotFile[] | string }> {
	const filesList: SnapShotFile[] = [];
	let errorMessage = '';
	let success = true;

	const seenPaths = new Set<string>();

	for (const srcPath of sourcePaths) {
		try {
			const currentFilesOutput = await runRcloneCommand([
				`lsjson`,
				`${srcPath}`,
				'--recursive',
				'--fast-list',
			]);
			const sourceFiles: RcloneLsJsonOutput[] = JSON.parse(currentFilesOutput);
			const srcFilesList = parseRcloneFilesList(sourceFiles, srcPath, rawPath);

			// Filter out duplicates using the Set
			for (const file of srcFilesList) {
				if (!seenPaths.has(file.path)) {
					seenPaths.add(file.path);
					filesList.push(file);
				}
			}
		} catch (error: any) {
			success = false;
			errorMessage = error?.message || 'Failed to get source files';
			console.log('getBackupSourceFiles error :', error);
		}
	}

	return { success, result: success ? filesList : errorMessage };
}

export default getBackupSourceFiles;
