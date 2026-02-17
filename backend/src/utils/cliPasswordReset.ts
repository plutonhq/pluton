import readline from 'readline';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { appPaths } from './AppPaths';

const BCRYPT_SALT_ROUNDS = 10;

/**
 * Prompts the user for input via stdin.
 * When `hidden` is true, input is not echoed (for passwords).
 */
function prompt(question: string, hidden = false): Promise<string> {
	return new Promise(resolve => {
		if (hidden) {
			// For hidden input, write the question directly and use raw mode
			process.stdout.write(question);
			const rl = readline.createInterface({
				input: process.stdin,
				output: new (require('stream').Writable)({
					write(_chunk: any, _encoding: any, callback: () => void) {
						callback(); // swallow all output (hides typed characters)
					},
				}),
				terminal: true,
			});

			rl.question('', answer => {
				rl.close();
				process.stdout.write('\n');
				resolve(answer);
			});
		} else {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			rl.question(question, answer => {
				rl.close();
				resolve(answer);
			});
		}
	});
}

/**
 * Stores the new password hash in keys.json and updates the keyring credentials.
 */
async function storeNewPassword(userName: string, password: string): Promise<void> {
	// Hash the password
	const hash = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);

	// Update keys.json with new PASSWORD_HASH
	const keysPath = path.join(appPaths.getDataDir(), 'keys.json');
	let keysFileContent: Record<string, any> = {};
	try {
		if (fs.existsSync(keysPath)) {
			keysFileContent = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
		}
	} catch {
		// Start fresh if keys.json is corrupted
	}

	keysFileContent.PASSWORD_HASH = hash;
	const dir = path.dirname(keysPath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(keysPath, JSON.stringify(keysFileContent, null, 2), { mode: 0o600 });

	// Update keyring credentials (if available)
	try {
		const { keyringService } = await import('../services/KeyringService');
		const isAvailable = await keyringService.waitForInitialization();
		if (isAvailable) {
			const { KEYRING_KEYS } = await import('../services/KeyringService');
			await keyringService.setCredential(KEYRING_KEYS.USER_NAME, userName);
			await keyringService.setCredential(KEYRING_KEYS.USER_PASSWORD, password);
			console.log('✅ Credentials updated in system keyring.');
		}
	} catch {
		// Keyring not available - that's fine, hash is stored in keys.json
	}

	console.log('✅ Password hash updated in keys.json.');
}

/**
 * Handles the --reset-password CLI command.
 * Prompts the user interactively for a new username and password.
 *
 * Usage:
 *   pluton --reset-password
 */
export async function handlePasswordReset(): Promise<void> {
	console.log('\n🔐 Pluton Password Reset\n');

	if (!process.stdin.isTTY) {
		console.error('❌ Password reset requires a terminal (TTY).');
		console.error('   Run this command in an interactive terminal.');
		process.exit(1);
	}

	const userName = (await prompt('Enter new username (default: admin): ')).trim() || 'admin';

	const password1 = await prompt('Enter new password: ', true);
	if (!password1) {
		console.error('❌ Password cannot be empty.');
		process.exit(1);
	}

	const password2 = await prompt('Confirm new password: ', true);
	if (password1 !== password2) {
		console.error('❌ Passwords do not match.');
		process.exit(1);
	}

	console.log(`\nResetting password for user: ${userName}`);
	await storeNewPassword(userName, password1);

	console.log(
		'\n✅ Password reset successful. You can now start Pluton and log in with your new credentials.\n'
	);
	process.exit(0);
}
