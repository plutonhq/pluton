type StandardInputReader = () => Promise<string>;

function readOption(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Reads the enrollment credential without forcing callers to put it in their
 * command history or process arguments. The legacy --token option remains
 * available for backwards compatibility, but the installer uses --token-stdin.
 */
export async function readEnrollmentToken(
	args: string[],
	readStandardInput: StandardInputReader = () =>
		new Promise((resolve, reject) => {
			let value = '';
			process.stdin.setEncoding('utf8');
			process.stdin.on('data', chunk => (value += chunk));
			process.stdin.once('end', () => resolve(value));
			process.stdin.once('error', reject);
			process.stdin.resume();
		})
): Promise<string> {
	const inlineToken = readOption(args, '--token');
	const useStandardInput = args.includes('--token-stdin');
	if (inlineToken && useStandardInput) {
		throw new Error('Choose either --token or --token-stdin.');
	}
	if (useStandardInput) {
		const token = (await readStandardInput()).trim();
		if (!token || /\s/.test(token)) throw new Error('Enrollment token is required.');
		return token;
	}
	if (!inlineToken || /\s/.test(inlineToken)) throw new Error('Enrollment token is required.');
	return inlineToken;
}
