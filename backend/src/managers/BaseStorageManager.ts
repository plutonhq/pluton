import { providers } from '../utils/providers';
import { runRcloneCommand } from '../utils/rclone/rclone';
import {
	isS3Storage,
	isHcpMode,
	rcloneRemoteEnvironment,
	S3_SECRET_FIELDS,
	storageDiagnosticCode,
	storageRcloneOptions,
	validateHcpConfiguration,
} from '../utils/storageSecurity';

export class BaseStorageManager {
	async createRemote(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<any> {
		if (isS3Storage(type) && isHcpMode(settings)) {
			validateHcpConfiguration(credentials, settings || {});
			return this.configureHcpRemote(name, type, credentials, settings || {}, false);
		}
		const provider = providers[type];
		const bucketName = credentials?.bucket ? credentials.bucket.trim() : '';
		if (!provider && type !== 'local') {
			throw new Error(`Unsupported storage type: ${type}`);
		}

		const rcloneStorageType = provider?.type || type;
		if (rcloneStorageType === 's3') {
			if (!bucketName) {
				return {
					success: false,
					result: 'Bucket Name is required.',
				};
			}
		}

		const args = ['config', 'create', name, rcloneStorageType];
		const setupArgs = provider.setup(credentials, authType);
		if (setupArgs === false) {
			throw new Error(`Missing Required credentials.`);
		}

		args.push(...setupArgs);

		// Add any additional settings
		if (settings) {
			Object.entries(settings).forEach(([key, value]) => {
				args.push(key, value);
			});
		}

		if (type === 'onedrive' && authType === 'oauth' && credentials.token) {
			// Workaround for Rclone Onedrive Bug:
			// https://forum.rclone.org/t/rclone-config-create-miss-some-info-and-doesnt-work-as-expect/21045
			const oneDriveCreds = JSON.parse(credentials.token);
			const myHeaders = new Headers();
			myHeaders.append('Authorization', oneDriveCreds.access_token);

			try {
				await fetch('https://graph.microsoft.com/v1.0/me/drive', {
					method: 'GET',
					headers: myHeaders,
					redirect: 'follow',
				})
					.then(response => response.json())
					.then((result: any) => {
						if (result && result.id && result.driveType) {
							args.push('drive_id', result.id, 'drive_type', result.driveType);
						}
					});
			} catch (error: any) {
				console.warn('[error] fetch onedrive drive_id & drive_type', error?.message || error);
				return {
					success: false,
					result:
						'Failed to fetch OneDrive drive information. Please verify your credentials and try again.',
				};
			}
		}

		// --obscure flag obscures all necessary values automatically.
		// --non-interactive field prevents asking questions, and adds the config directly.
		args.push('--obscure', '--non-interactive');

		try {
			// console.log('rclone Command: ', args.join(' '));
			const output = await runRcloneCommand(args);

			try {
				const lsdOutput = await runRcloneCommand(['lsd', name + ':' + (bucketName ?? '')]);
				// console.log('lsd Success :', lsdOutput);
				return {
					success: true,
					result: output,
				};
			} catch (error: any) {
				const storageListingError = (error?.message || '').split('\n')[0];
				await runRcloneCommand(['config', 'delete', name]);
				return {
					success: false,
					result: storageListingError,
				};
			}
		} catch (error: any) {
			// split the first line and return only the error message
			const storageCreateError = (error?.message || '').split('\n')[0];

			return {
				success: false,
				result: storageCreateError,
			};
		}
	}

	async updateRemote(
		name: string,
		newSettings: Record<string, any>,
		oldSettings: Record<string, any>
	): Promise<any> {
		if (isHcpMode(newSettings) || isHcpMode(oldSettings)) {
			const options = { ...oldSettings, ...newSettings };
			const type = String(options._pluton_storage_type || 's3compatible');
			if (!isS3Storage(type)) throw new Error('Unsupported protected S3 storage type.');
			validateHcpConfiguration(options, options);
			const result = await this.configureHcpRemote(name, type, options, options, true);
			if (!result.success) await this.configureHcpRemote(name, type, oldSettings, oldSettings, true);
			return result;
		}
		// Filter out settings that need to be updated vs removed
		// When a setting is in the config file and it is not provided on subsequent updates,
		// its reset to default by rclone
		const availableCreds = newSettings.credentials || oldSettings.credentials;
		const bucketName = availableCreds?.bucket ? availableCreds?.bucket.trim() : '';
		const updateArgs = ['config', 'update', name];
		Object.entries(newSettings).forEach(([key, value]) => {
			updateArgs.push(key, value.toString());
		});

		try {
			// console.log('rclone updateArgs :', updateArgs);
			// --obscure is also used on create, so passwords keep the same form after an update.
			const output = await runRcloneCommand([...updateArgs, '--obscure', '--non-interactive']);

			// Verify the remote still works after update
			try {
				const lsdOutput = await runRcloneCommand(['lsd', name + ':' + (bucketName ?? '')]);

				return {
					success: true,
					result: output,
				};
			} catch (error: any) {
				// Revert to old settings
				const revertArgs = ['config', 'update', name, '--obscure', '--non-interactive'];
				Object.entries(oldSettings).forEach(([key, value]) => {
					revertArgs.push(key, value.toString());
				});
				await runRcloneCommand(revertArgs);

				return {
					success: false,
					result: error?.message || '',
				};
			}
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	private async configureHcpRemote(
		name: string,
		type: string,
		credentials: Record<string, string>,
		settings: Record<string, any>,
		update: boolean
	): Promise<any> {
		const options = storageRcloneOptions(
			{ type, credentials: null, settings },
			credentials
		);
		const environment = rcloneRemoteEnvironment(name, options);
		const args = ['config', update ? 'update' : 'create', name, ...(update ? [] : ['s3'])];
		for (const [key, value] of Object.entries(options)) {
			if (!S3_SECRET_FIELDS.has(key)) args.push(key, value);
		}
		// Explicitly clear any reversible legacy credential fields when enabling HCP mode.
		if (update) for (const key of S3_SECRET_FIELDS) args.push(key, '');
		args.push('--non-interactive');
		try {
			await runRcloneCommand(args);
			await runRcloneCommand(['lsd', `${name}:${credentials.bucket}`], environment);
			return { success: true, result: 'Existing S3 namespace verified.' };
		} catch (error) {
			if (!update) await runRcloneCommand(['config', 'delete', name]).catch(() => undefined);
			return {
				success: false,
				result: `${storageDiagnosticCode(error)}: S3 namespace verification failed. Check endpoint, TLS trust and scoped credentials.`,
			};
		}
	}

	async deleteRemote(name: string): Promise<any> {
		try {
			const output = await runRcloneCommand(['config', 'delete', name]);
			return {
				success: true,
				result: output,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async getRemoteConfig(name: string): Promise<any> {
		try {
			const output = await runRcloneCommand(['config', 'show', name]);

			// Parse the output into JSON format
			const lines = output.trim().split('\n');
			const result: Record<string, string> = {};
			let remoteName = '';
			const errorLines: string[] = [];
			const configLines: string[] = [];

			for (const line of lines) {
				const trimmedLine = line.trim();

				// Skip empty lines
				if (!trimmedLine) continue;

				// Extract remote name from [RemoteName] format
				if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
					remoteName = trimmedLine.slice(1, -1);
					result.name = remoteName;
					continue;
				}

				// Collect all lines that are not the remote name
				configLines.push(trimmedLine);

				// Check for error comments
				if (trimmedLine.startsWith('#')) {
					errorLines.push(trimmedLine);
					continue;
				}

				// Parse key = value pairs
				if (trimmedLine.includes(' = ')) {
					const [key, ...valueParts] = trimmedLine.split(' = ');
					const value = valueParts.join(' = '); // Handle values that might contain ' = '
					if (key && value !== undefined) {
						result[key.trim()] = value.trim();
					}
				}
			}

			// Determine if it's an error: ALL config lines (excluding remote name) must start with #
			const hasErrors = configLines.length > 0 && configLines.every(line => line.startsWith('#'));

			// If there are errors, return the concatenated error messages
			if (hasErrors) {
				return {
					success: false,
					result: errorLines.join(' ').replace(/^#\s*/, ''), // Remove leading # and whitespace
				};
			}

			return {
				success: true,
				result: result,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async verifyRemote(name: string, bucket?: string): Promise<{ success: boolean; result: string }> {
		try {
			const lsdOutput = await runRcloneCommand(['lsd', name + ':' + (bucket ?? '')]);
			return {
				success: true,
				result: lsdOutput,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async listRemotes(): Promise<any> {
		try {
			const output = await runRcloneCommand(['listremotes']);
			return {
				success: true,
				result: output,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async browseRemote(remote: string, path: string = '/'): Promise<any> {
		try {
			const output = await runRcloneCommand(['lsjson', `${remote}:${path}`]);

			return {
				success: true,
				result: {
					path,
					items: JSON.parse(output).map((item: any) => ({
						name: item.Name,
						type: item.IsDir ? 'dir' : 'file',
						size: item.Size,
						modTime: item.ModTime,
						path: item.Path,
					})),
				},
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async getRemoteFileContent(remote: string, path: string): Promise<any> {
		try {
			const output = await runRcloneCommand(['cat', `${remote}:${path}`]);
			return {
				success: true,
				result: output,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async getDownloadLink(remote: string, path: string): Promise<any> {
		try {
			// Get public link (works for supported providers like S3, B2, etc)
			const link = await runRcloneCommand(['link', `${remote}:${path}`]);
			return {
				success: true,
				result: link.trim(),
			};
		} catch (error: any) {
			// If provider doesn't support public links, return null
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}
}
