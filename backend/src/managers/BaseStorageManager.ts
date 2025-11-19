import { providers } from '../utils/providers';
import { runRcloneCommand } from '../utils/rclone/rclone';

export class BaseStorageManager {
	async setupRclone() {
		// Encrypt Rclone Config file.
		// set the password in RCLONE_CONFIG_PASS env then run:
		// rclone config encryption set --config=rclone.conf --encrypted-config=rclone.conf.enc --ask-password=false

		// Remove the rclone.conf file
		if (process.platform === 'win32') {
			// use rm to remove rclone.conf file
		} else {
			// If linux, use shred to remove the file
		}
	}

	async createRemote(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<any> {
		const provider = providers[type];
		if (!provider && type !== 'local') {
			throw new Error(`Unsupported storage type: ${type}`);
		}

		const args = ['config', 'create', name, type];
		args.push(...provider.setup(credentials, authType));

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
			console.log('[rclone] fetch onedrive drive_id & drive_type');
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
						console.log('result.id :', result.id);
						console.log('result.driveType :', result.driveType);
						if (result && result.id && result.driveType) {
							args.push('drive_id', result.id, 'drive_type', result.driveType);
						}
					});
			} catch (error: any) {
				console.log('error :', error);
			}
		}

		// --obscure flag obscures all necessary values automatically.
		// --non-interactive field prevents asking questions, and adds the config directly.
		args.push('--obscure', '--non-interactive');

		try {
			// console.log('rclone Command: ', args.join(' '));
			const output = await runRcloneCommand(args);

			try {
				const lsdOutput = await runRcloneCommand(['lsd', name + ':']);
				// console.log('lsd Success :', lsdOutput);
				return {
					success: true,
					result: output,
				};
			} catch (error: any) {
				console.log('lsd error:', error);
				await runRcloneCommand(['config', 'delete', name]);
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

	async updateRemote(
		name: string,
		newSettings: Record<string, string | number | boolean>,
		oldSettings: Record<string, string | number | boolean>
	): Promise<any> {
		// Filter out settings that need to be updated vs removed
		// When a setting is in the config file and it is not provided on subsequent updates,
		// its reset to default by rclone
		const updateArgs = ['config', 'update', name];
		Object.entries(newSettings).forEach(([key, value]) => {
			updateArgs.push(key, value.toString());
		});

		try {
			// console.log('rclone updateArgs :', updateArgs);
			const output = await runRcloneCommand([...updateArgs, '--non-interactive']);

			// Verify the remote still works after update
			try {
				const lsdOutput = await runRcloneCommand(['lsd', name + ':']);

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

	async verifyRemote(name: string): Promise<{ success: boolean; result: string }> {
		try {
			const lsdOutput = await runRcloneCommand(['lsd', name + ':']);
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
