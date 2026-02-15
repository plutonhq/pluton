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
	const fileName = secure ? 'rclone.conf.enc' : 'rclone.conf';
	const rcloneConfPath = path.join(appPaths.getConfigDir(), fileName);
	return rcloneConfPath;
};

export async function encryptRcloneConfig(
	password: string
): Promise<{ success: boolean; result: string }> {
	try {
		await runRcloneCommand(['config', 'encryption', 'check']);
		return {
			success: true,
			result: 'Encryption already completed. Skipped.',
		};
	} catch (error: any) {
		console.log('[Security Error]Rclone Config File Not encrypted. Starting Encryption...');
		const envVarName = `RCLONE_TEMP_PASS_${Date.now()}`;
		try {
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
			return {
				success: true,
				result: res,
			};
		} catch (error: any) {
			console.log('[encryptRcloneConfig] error :', error);
			return {
				success: false,
				result: error?.message || '',
			};
		} finally {
			delete process.env[envVarName];
		}
	}
}
