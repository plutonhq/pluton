import { providers } from '../utils/providers';
import { runRcloneCommand } from '../utils/rclone/rclone';

export class BaseStorageManager {
	async createRemote(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<any> {
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
			const output = await runRcloneCommand([...updateArgs, '--non-interactive']);

			// Verify the remote still works after update
			try {
				const lsdOutput = await runRcloneCommand(['lsd', name + ':' + (bucketName ?? '')]);

				return {
					success: true,
					result: output,
				};
			} catch (error: any) {
				// Revert to old settings
				const revertArgs = ['config', 'update', name, '--non-interactive'];
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
