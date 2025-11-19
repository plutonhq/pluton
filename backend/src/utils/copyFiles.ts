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
	// Use the arguments directly as Robocopy source and destination
	const robocopySource = sourcePath;
	const robocopyDestination = destinationPath;

	const robocopyArgsList = [
		robocopySource,
		robocopyDestination,
		// '/B' (Backup mode) is powerful. Use with caution.
		// It allows copying files even if necessary permissions isn't present,
		// and can set security information.
		// For general copying, /E (subdirs, incl. empty) or /S (subdirs, not empty) is common.
		// Consider if /B is truly needed. If not, remove it or use a more standard option.
		'/E', // Example: Copy subdirectories, including empty ones.
	];

	switch (overwritePolicy) {
		case 'always':
			// /COPYALL includes Data, Attributes, Timestamps, Security (ACLs), Owner, Auditing info.
			// /COPY:DATSOU is equivalent to /COPYALL
			// /COPY:DAT is often sufficient for data backup (Data, Attributes, Timestamps).
			robocopyArgsList.push('/COPY:DAT', '/W:1', '/R:1'); // Or /COPYALL if needed
			break;
		case 'if-changed':
			// Robocopy considers files changed if timestamp or size is different.
			// It doesn't do checksum by default like rsync.
			// /XO (Exclude Older) + /XC (Exclude Changed - but this skips files present in dest)
			// Simply using /E or /S without /XO, /XN, /XC will copy if source is newer or different.
			robocopyArgsList.push('/XO', '/XC'); // This means "copy if newer, skip if same or older, skip if attributes changed but not newer"
			// Often, just /E is sufficient for "update" behavior.
			break;
		case 'if-newer':
			robocopyArgsList.push('/XO'); // Exclude Older files (only copy if source is newer)
			break;
		case 'never':
			robocopyArgsList.push('/XC', '/XN', '/XO'); // Exclude Changed, Newer, Older (effectively don't overwrite existing)
			break;
	}

	// Ensure paths with spaces are correctly handled by PowerShell's ArgumentList
	// The existing map to `"${arg}"` then join with `, ` is for PowerShell array syntax in a string.
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
			stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
		});

		let stdoutData = '';
		let stderrData = '';

		if (subprocess.stdout) {
			subprocess.stdout.on('data', data => {
				stdoutData += data.toString();
				// console.log('Robocopy stdout:', data.toString()); // For live debugging
			});
		}
		if (subprocess.stderr) {
			subprocess.stderr.on('data', data => {
				stderrData += data.toString();
				// console.error('Robocopy stderr:', data.toString()); // For live debugging
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
				// Relaxed success, includes files skipped or extra files found
				resolve();
			} else {
				let errorMessage = `Robocopy process exited with code ${code}.`;
				if (stderrData.trim()) {
					errorMessage += `\nPowerShell Stderr: ${stderrData.trim()}`;
				}
				if (code !== null) {
					// Robocopy often outputs detailed logs to stdout, even on failure
					if (stdoutData.trim() && (code >= 8 || code === 16)) {
						// Show stdout for errors
						errorMessage += `\nPowerShell Stdout: ${stdoutData.trim()}`;
					}
					// Differentiate PowerShell script errors
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
