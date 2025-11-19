import path from 'path';
import os from 'os';
import { appPaths } from '../AppPaths';
import { runRcloneCommand } from './rclone';

// export const getRcloneConfigPath = (secure = false) => {
// 	let rcloneConfigPath = '';
// 	let fileName = secure ? 'rclone.conf.enc' : 'rclone.conf';
// 	if (process.platform === 'win32') {
// 		rcloneConfigPath = path.join(process.env.APPDATA || '', 'rclone', fileName);
// 	} else {
// 		rcloneConfigPath = path.join(os.homedir(), `.config/rclone/${fileName}`);
// 	}

// 	return rcloneConfigPath;
// };

export const getRcloneConfigPath = (secure = false) => {
	let fileName = secure ? 'rclone.conf.enc' : 'rclone.conf';
	const rcloneConfPath = path.join(appPaths.getConfigDir(), fileName);
	return rcloneConfPath;
};

export async function encryptRcloneConfig(
	password: string
): Promise<{ success: boolean; result: string }> {
	return new Promise(async resolve => {
		try {
			const encryptCheckRes = await runRcloneCommand(['config', 'encryption', 'check']);
			if (!encryptCheckRes) {
				return resolve({
					success: true,
					result: 'Encryption already completed. Skipped.',
				});
			}
		} catch (error: any) {
			console.log('[Security Error]Rclone Config File Not encrypted. Starting Encryption...');
			const envVarName = `RCLONE_TEMP_PASS_${Date.now()}`;
			try {
				// Use echo with environment variable - simplest approach

				const passwordCommand =
					os.platform() === 'win32' ? `cmd /c "echo %${envVarName}%"` : `/bin/echo $${envVarName}`;

				const res = await runRcloneCommand(
					['config', 'encryption', 'set', '--password-command', passwordCommand],
					{
						[envVarName]: password,
					}
				);

				if (res.includes('failed')) {
					throw new Error(res);
				}
				console.log('[encryptRcloneConfig] success :', res);
				return resolve({
					success: true,
					result: res,
				});
			} catch (error: any) {
				console.log('[encryptRcloneConfig] error :', error);
				return resolve({
					success: false,
					result: error?.message || '',
				});
			} finally {
				// SECURITY: Clean up the environment variable immediately
				delete process.env[envVarName];
			}
		}
	});
}
