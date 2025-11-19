import { spawn } from 'child_process';
import os from 'os';
import { getBinaryPath } from '../binaryPathResolver';
import { getRcloneConfigPath } from './helpers';

export function runRcloneCommand(args: string[], env?: Record<string, string>): Promise<string> {
	return new Promise((resolve, reject) => {
		const rcloneBinary = getBinaryPath('rclone');
		const rcloneConfigPath = getRcloneConfigPath();
		const localAppData = process.env.LOCALAPPDATA || os.homedir();
		const envVars = {
			// ...process.env,
			RCLONE_CONFIG: rcloneConfigPath,
			LOCALAPPDATA: localAppData,
			RCLONE_CONFIG_PASS: process.env.ENCRYPTION_KEY,
			...env,
		};
		console.log('rcloneBinary :', rcloneBinary);
		const rcProcess = spawn(rcloneBinary, args, { env: envVars });
		let output = '';
		let errorOutput = '';
		// console.log('runRcloneCommand :', ['rclone', ...args].join(' '), envVars);

		rcProcess.stdout?.on('data', (data: Buffer) => {
			// console.log('[rclone] Data :', data.toString());
			output += data.toString();
		});

		rcProcess.stderr?.on('data', (data: Buffer) => {
			// console.log('[rclone] Error :', data.toString());
			errorOutput += data.toString();
		});

		rcProcess.on('close', (code: number) => {
			console.log('[rclone] Close Fired!! Code :', code);
			if (code === 0) {
				const outputRes = output.trim();
				const errorOutputRes = errorOutput.trim();
				if (outputRes) {
					resolve(outputRes);
				} else if (errorOutputRes) {
					resolve(errorOutputRes);
				} else {
					resolve('');
				}
			} else {
				reject(new Error(errorOutput || `Rclone command failed`));
			}
		});
	});
}
