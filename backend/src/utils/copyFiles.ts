import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';

/**
 * Copies files from one location to another using platform-specific commands.
 * On Windows, it uses Robocopy; on Unix-like systems, it uses rsync or cp.
 *
 * @param copyFrom - The source directory to copy files from.
 * @param copyTo - The destination directory to copy files to.
 * @param overwritePolicy - Policy for overwriting files: 'always', 'if-changed', 'if-newer', 'never'.
 * @returns A promise that resolves when the copy operation is complete.
 */
const copyFiles = (
	copyFrom: string,
	copyTo: string,
	overwritePolicy: 'always' | 'if-changed' | 'if-newer' | 'never' = 'always'
): Promise<void> => {
	if (process.platform === 'win32') {
		return copyFilesWindows(copyFrom, copyTo, overwritePolicy);
	} else {
		return copyFilesUnix(copyFrom, copyTo, overwritePolicy);
	}
};

const copyFilesWindows = (
	sourcePath: string, // Renamed for clarity, this is your intended source
	destinationPath: string, // Renamed for clarity, this is your intended destination
	overwritePolicy: 'always' | 'if-changed' | 'if-newer' | 'never' = 'always'
): Promise<void> => {
	// Check if running as a pkg build (Windows service)
	const isPkg = (process as any).pkg;

	// Use the arguments directly as Robocopy source and destination
	const robocopySource = sourcePath;
	const robocopyDestination = destinationPath;

	const robocopyArgsList = [
		robocopySource,
		robocopyDestination,
		// /E copies subdirectories, including empty ones.
		'/E',
	];

	switch (overwritePolicy) {
		case 'always':
			// /COPY:DAT copies Data, Attributes, Timestamps.
			// /W:1 /R:1 sets wait time and retry count to 1 for faster failure on locked files.
			robocopyArgsList.push('/COPY:DAT', '/W:1', '/R:1');
			break;
		case 'if-changed':
			// Robocopy considers files changed if timestamp or size is different.
			// /XO excludes older files, /XC excludes files with same timestamp and size.
			robocopyArgsList.push('/XO', '/XC');
			break;
		case 'if-newer':
			robocopyArgsList.push('/XO'); // Exclude Older files (only copy if source is newer)
			break;
		case 'never':
			robocopyArgsList.push('/XC', '/XN', '/XO'); // Exclude Changed, Newer, Older (effectively don't overwrite existing)
			break;
	}

	// In pkg builds (Windows service), spawn robocopy directly since the service
	// already runs with admin privileges. UAC elevation via PowerShell's -Verb runas
	// fails in services because they run in session 0 (non-interactive).
	if (isPkg) {
		return copyFilesWindowsDirect(robocopyArgsList);
	}

	// In development, use PowerShell with UAC elevation for admin privileges
	return copyFilesWindowsWithUAC(robocopyArgsList);
};

/**
 * Runs robocopy directly without UAC elevation.
 * Used in pkg builds where the app runs as a Windows service with admin privileges.
 */
const copyFilesWindowsDirect = (robocopyArgsList: string[]): Promise<void> => {
	return new Promise((resolve, reject) => {
		const subprocess = spawn('robocopy', robocopyArgsList, {
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: true,
		});

		let stdoutData = '';
		let stderrData = '';

		if (subprocess.stdout) {
			subprocess.stdout.on('data', data => {
				stdoutData += data.toString();
			});
		}
		if (subprocess.stderr) {
			subprocess.stderr.on('data', data => {
				stderrData += data.toString();
			});
		}

		subprocess.on('error', err => {
			reject(new Error(`Failed to start robocopy process: ${err.message}. Stderr: ${stderrData}`));
		});

		subprocess.on('close', code => {
			// Robocopy exit codes:
			// 0 - No files copied, no errors
			// 1 - Files copied successfully
			// 2 - Extra files or directories detected
			// 4 - Mismatched files or directories detected
			// 8 - Some files or directories could not be copied (copy errors)
			// 16 - Serious error. No files copied.
			// Codes 0-7 are generally considered success (some files may be skipped)
			if (code !== null && code < 8) {
				resolve();
			} else {
				let errorMessage = `Robocopy process exited with code ${code}.`;
				if (code === 16) {
					errorMessage +=
						' Serious error - this may indicate permission issues, invalid paths, or insufficient disk space.';
				} else if (code !== null && code >= 8) {
					errorMessage += ' Some files could not be copied due to errors.';
				}
				if (stderrData.trim()) {
					errorMessage += `\nStderr: ${stderrData.trim()}`;
				}
				if (stdoutData.trim()) {
					errorMessage += `\nOutput: ${stdoutData.trim()}`;
				}
				reject(new Error(errorMessage));
			}
		});
	});
};

/**
 * Runs robocopy via PowerShell with UAC elevation.
 * Used in development where admin privileges need to be requested via UAC prompt.
 */
const copyFilesWindowsWithUAC = (robocopyArgsList: string[]): Promise<void> => {
	// Ensure paths with spaces are correctly handled by PowerShell's ArgumentList
	const quotedArgsForPs = robocopyArgsList.map(arg => `"${arg.replace(/"/g, '`"')}"`).join(', ');

	const psCommand = `
        $ErrorActionPreference = 'Stop'
        try {
            $process = Start-Process robocopy -ArgumentList ${quotedArgsForPs} -Verb runas -PassThru -Wait;
            if ($null -ne $process) {
                exit $process.ExitCode
            } else {
                Write-Error "Failed to start robocopy process or UAC was denied."
                exit 2001
            }
        } catch {
            Write-Error "PowerShell script failed: $($_.Exception.Message)"
            exit 2000
        }
    `;

	return new Promise((resolve, reject) => {
		const subprocess = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', psCommand], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdoutData = '';
		let stderrData = '';

		if (subprocess.stdout) {
			subprocess.stdout.on('data', data => {
				stdoutData += data.toString();
			});
		}
		if (subprocess.stderr) {
			subprocess.stderr.on('data', data => {
				stderrData += data.toString();
			});
		}

		subprocess.on('error', err => {
			reject(
				new Error(`Failed to start PowerShell process: ${err.message}. Stderr: ${stderrData}`)
			);
		});

		subprocess.on('close', code => {
			// Robocopy success codes are 0-7 (or 0-3 for stricter success)
			// >= 8 means errors occurred during copy.
			if (code !== null && code < 8) {
				resolve();
			} else {
				let errorMessage = `Robocopy process exited with code ${code}.`;
				if (stderrData.trim()) {
					errorMessage += `\nPowerShell Stderr: ${stderrData.trim()}`;
				}
				if (code !== null) {
					if (stdoutData.trim() && (code >= 8 || code === 16)) {
						errorMessage += `\nPowerShell Stdout: ${stdoutData.trim()}`;
					}
					if (code === 2000) {
						errorMessage = `PowerShell script execution failed (code ${code}). Details: ${stderrData.trim() || stdoutData.trim()}`;
					} else if (code === 2001) {
						errorMessage = `Failed to get Robocopy process object (code ${code}), UAC might have been denied. Details: ${stderrData.trim() || stdoutData.trim()}`;
					}
				}
				reject(new Error(errorMessage));
			}
		});
	});
};

const copyFilesUnix = async (
	copyFrom: string,
	restorePath: string,
	overwritePolicy: 'always' | 'if-changed' | 'if-newer' | 'never' = 'always'
): Promise<void> => {
	// Check if restore path exists (source for copying)
	try {
		await access(restorePath, constants.F_OK);
	} catch {
		throw new Error(`Restore path does not exist: ${restorePath}`);
	}

	// Use rsync for Unix-like systems (Linux, macOS)
	const rsyncArgs = ['-a', '--progress'];

	switch (overwritePolicy) {
		case 'always':
			// Default behavior - overwrite all files
			break;
		case 'if-changed':
			rsyncArgs.push('--checksum'); // Compare by checksum, not just timestamp/size
			break;
		case 'if-newer':
			rsyncArgs.push('--update'); // Skip files that are newer on receiver
			break;
		case 'never':
			rsyncArgs.push('--ignore-existing'); // Skip updating files that exist on receiver
			break;
	}

	// Ensure restore path ends with / to copy contents, not the directory itself
	const normalizedSource = restorePath.endsWith('/') ? restorePath : restorePath + '/';
	rsyncArgs.push(normalizedSource, copyFrom); // Copy FROM restorePath TO copyFrom

	return new Promise((resolve, reject) => {
		const subprocess = spawn('rsync', rsyncArgs, {
			stdio: 'inherit',
		});

		subprocess.on('error', err => {
			// If rsync is not available, fall back to cp
			if (err.message.includes('ENOENT')) {
				return copyFilesUnixFallback(copyFrom, restorePath, overwritePolicy)
					.then(resolve)
					.catch(reject);
			}
			reject(new Error(`Failed to start rsync: ${err.message}`));
		});

		subprocess.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`rsync failed with code ${code}`));
			}
		});
	});
};

const copyFilesUnixFallback = (
	copyFrom: string,
	restorePath: string,
	overwritePolicy: 'always' | 'if-changed' | 'if-newer' | 'never' = 'always'
): Promise<void> => {
	// Fallback to cp command if rsync is not available
	const cpArgs = ['-R']; // Recursive

	switch (overwritePolicy) {
		case 'always':
			cpArgs.push('-f'); // Force overwrite
			break;
		case 'if-changed':
		case 'if-newer':
			cpArgs.push('-u'); // Update - copy only when source is newer
			break;
		case 'never':
			cpArgs.push('-n'); // No overwrite
			break;
	}

	// Ensure restore path ends with /. to copy contents
	const normalizedSource = restorePath.endsWith('/') ? restorePath + '.' : restorePath + '/.';
	cpArgs.push(normalizedSource, copyFrom); // Copy FROM restorePath TO copyFrom

	return new Promise((resolve, reject) => {
		const subprocess = spawn('cp', cpArgs, {
			stdio: 'inherit',
		});

		subprocess.on('error', err => {
			reject(new Error(`Failed to start cp: ${err.message}`));
		});

		subprocess.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`cp failed with code ${code}`));
			}
		});
	});
};

export default copyFiles;
