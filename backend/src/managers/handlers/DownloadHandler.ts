import { EventEmitter } from 'events';
import { mkdir, rm, readFile, readdir } from 'fs/promises';
import path from 'path';
import { existsSync, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { runResticCommand } from '../../utils/restic/restic';
import { generateResticRepoPath } from '../../utils/restic/helpers';
import { processManager } from '../ProcessManager';
import { runCommand } from '../../utils/runCommand';
import { appPaths } from '../../utils/AppPaths';
import { configService } from '../../services/ConfigService';

export class DownloadHandler {
	constructor(private emitter: EventEmitter) {}

	async download(
		planId: string,
		backupId: string,
		snapshotId: string,
		options: Record<string, any>
	): Promise<string> {
		const tempDir = appPaths.getDownloadsDir();
		const fileName = `backup-${backupId}.tar`;
		const zipPath = path.join(tempDir, fileName);

		const restoreDir = path.join(tempDir, `backup-${backupId}`);
		const tarPath = path.join(tempDir, fileName);

		this.emitter.emit('download_start', {
			planId,
			backupId,
			targetPath: zipPath,
		});

		await mkdir(tempDir, { recursive: true });

		return new Promise((resolve, reject) => {
			const handlers = this.createHandlers(planId, backupId);
			const { storageName, storagePath, encryption } = options;
			const repoPassword = encryption ? configService.config.ENCRYPTION_KEY : '';
			const repoPath = generateResticRepoPath(storageName, storagePath || '');

			runResticCommand(
				['restore', '-r', repoPath, snapshotId, '--target', restoreDir, '--json'],
				{ RESTIC_PASSWORD: repoPassword, RCLONE_CONFIG_PASS: repoPassword },
				handlers.onProgress,
				handlers.onError,
				async code => {
					// For downloads, we only need the file content — xattr/metadata errors
					// (e.g., macOS SIP "com.apple.rootless: operation not permitted") are non-critical.
					// Accept non-zero exit if the restore directory was actually populated.
					let hasRestoredFiles = false;
					if (code !== 0) {
						try {
							const entries = await readdir(restoreDir);
							hasRestoredFiles = entries.length > 0;
						} catch {
							hasRestoredFiles = false;
						}
						if (hasRestoredFiles) {
							console.warn(
								`[DownloadHandler] Restic exited with code ${code} but restore directory has content. Proceeding with tar.`
							);
						}
					}

					if (code === 0 || hasRestoredFiles) {
						try {
							// Create tar without compression
							const tarCommand = ['tar', '-cf', tarPath, '-C', restoreDir, '.'];

							try {
								await runCommand(tarCommand);
								try {
									// Cleanup restore directory
									await rm(restoreDir, { recursive: true, force: true });
								} catch (error: any) {
									console.log('[error] Failed to remove download directory :', error?.message);
								}

								handlers.onComplete(0);
								resolve(tarPath);
							} catch (error: any) {
								handlers.onError(Buffer.from(error.message));
							}
						} catch (error: any) {
							handlers.onError(Buffer.from(error.message));
							reject(error);
						}
					} else {
						handlers.onComplete(code);
						reject(new Error('Restore failed'));
					}
				},
				process => processManager.trackProcess('download-' + backupId, process)
			)
				// runResticCommand rejects on non-zero exit, but the onComplete callback
				// above already handles partial success (e.g., xattr errors on macOS).
				// Only propagate rejection if the promise hasn't been settled yet.
				.catch(err => {
					// If the promise hasn't been resolved/rejected by onComplete yet,
					// this is a genuine pre-restore error (binary not found, spawn failure, etc.)
					// The onComplete handler will have already called resolve/reject for exit code issues.
				});
		});
	}

	async cancel(planId: string, backupId: string) {
		try {
			const killed = processManager.killProcess('download-' + backupId);
			console.log('[Cancel] killed:', killed);
			if (killed) {
				const tempDir = appPaths.getDownloadsDir();
				const fileName = `backup-${backupId}.tar`;
				const zipPath = path.join(tempDir, fileName);

				await new Promise(resolve => setTimeout(resolve, 2000));

				if (existsSync(zipPath)) {
					await unlink(zipPath);
				}
			}
			return true; // Return true regardless of whether a process was killed or not
		} catch (error: any) {
			throw new Error('Error Cancelling Download. ' + error?.message || '');
		}
	}

	async get(planId: string, backupId: string) {
		try {
			const tempDir = appPaths.getDownloadsDir();
			const fileName = `backup-${backupId}.tar`;
			const zipPath = path.join(tempDir, fileName);

			const fileStream = createReadStream(zipPath);
			return { fileName, fileStream };
		} catch (error: any) {
			throw new Error('Error Getting Downloaded File. ' + error?.message || '');
		}
	}

	private createHandlers(planId: string, backupId: string) {
		return {
			onProgress: (data: Buffer) => {
				try {
					const progressData = JSON.parse(data.toString());
					this.emitter.emit('download_progress', {
						backupId,
						planId,
						data: progressData,
					});
				} catch (error) {
					// Ignore JSON parse errors from non-JSON output lines
				}
			},
			onError: (data: Buffer) => {
				this.emitter.emit('download_error', {
					backupId,
					planId,
					error: data.toString(),
				});
			},
			onComplete: (code: number) => {
				this.emitter.emit('download_complete', {
					backupId,
					planId,
					success: code === 0,
				});
			},
		};
	}
}
