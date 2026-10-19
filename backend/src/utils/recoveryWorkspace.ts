import fs from 'fs/promises';
import path from 'path';
import { isPathWithin, resolvePathWithin } from './legacySnapshotPath';
import { RecoveryTestError } from './recoveryValidation';

/** Dedicated ownership/lifetime: never points to manual restore, source or repository. */
export class RecoveryWorkspace {
	constructor(readonly root: string) {}
	path(id: string) {
		if (!/^[a-f0-9]{24}$/.test(id)) throw new RecoveryTestError('job', 'unsafe-workspace');
		return resolvePathWithin(this.root, `run-${id}`);
	}
	async create(id: string) {
		await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
		await this.assertDirectory(this.root);
		await fs.chmod(this.root, 0o700);
		const directory = this.path(id);
		await fs.mkdir(directory, { mode: 0o700 }); // exclusive; no stale reuse
		await fs.mkdir(path.join(directory, 'files'), { mode: 0o700 });
		await this.assert(id);
		return directory;
	}
	private async assertDirectory(directory: string) {
		const stat = await fs.lstat(directory);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new RecoveryTestError('job', 'unsafe-workspace');
	}
	async assert(id: string) {
		const directory = this.path(id);
		await this.assertDirectory(this.root);
		await this.assertDirectory(directory);
		if (!isPathWithin(await fs.realpath(this.root), await fs.realpath(directory)))
			throw new RecoveryTestError('job', 'unsafe-workspace');
		return directory;
	}
	async remove(id: string) {
		const directory = this.path(id);
		try {
			await fs.lstat(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
			throw error;
		}
		await this.assert(id);
		// Restic may restore read-only directories. chmod only owned, contained directories;
		// never follow symlinks, even during failed-restore cleanup.
		const unlock = async (candidate: string): Promise<void> => {
			const stat = await fs.lstat(candidate);
			if (!stat.isDirectory() || stat.isSymbolicLink()) return;
			if (
				(process.getuid && stat.uid !== process.getuid()) ||
				!isPathWithin(await fs.realpath(this.root), await fs.realpath(candidate))
			)
				throw new RecoveryTestError('workspace-cleanup', 'unsafe-workspace');
			await fs.chmod(candidate, 0o700);
			for (const entry of await fs.readdir(candidate)) await unlock(path.join(candidate, entry));
		};
		await unlock(directory);
		await fs.rm(directory, { recursive: true, force: true });
	}
}
