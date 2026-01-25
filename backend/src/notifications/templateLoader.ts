import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Utility for loading template files that works in:
 * - Development mode (tsx, running from source)
 * - Production mode (node, running from dist/ after tsc build)
 * - Pkg mode (pkg executable with bundled assets in snapshot filesystem)
 *
 * In pkg builds, files are bundled into a virtual filesystem snapshot.
 * We use import.meta.url to get the correct path relative to the module.
 */

// Check if running inside a pkg executable
const isPkg = typeof (process as any).pkg !== 'undefined';

// Get current directory using import.meta.url (works in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the base path for templates based on the execution context
 */
function getTemplateBasePath(): string {
	if (isPkg) {
		// In pkg, the bundled file is at dist/pkg-index.cjs
		// __dirname will be /snapshot/.../backend/dist/
		// Templates are bundled at /snapshot/.../backend/src/notifications/templates/
		// So we go from dist/ → src/notifications/templates/
		return path.join(__dirname, '..', 'src', 'notifications', 'templates');
	}

	// Try multiple paths for non-pkg environments:
	// 1. Relative to __dirname (works for dist/ builds where templates are copied)
	// 2. src/ folder relative to process.cwd() (works for development)
	// 3. dist/ folder relative to process.cwd() (works for production builds)
	const possiblePaths = [
		// Templates relative to this module (dist/notifications/templates or src/notifications/templates)
		path.join(__dirname, 'templates'),
		// Development: src folder
		path.join(process.cwd(), 'src', 'notifications', 'templates'),
		// Production: dist folder (if templates are copied there)
		path.join(process.cwd(), 'dist', 'notifications', 'templates'),
	];

	for (const testPath of possiblePaths) {
		if (existsSync(path.join(testPath, 'email'))) {
			return testPath;
		}
	}

	// Fallback to development path
	return path.join(process.cwd(), 'src', 'notifications', 'templates');
}

/**
 * Load a template file and return its contents as a string
 * @param templatePath - Path relative to the templates directory (e.g., 'email/email.html')
 */
export function loadTemplate(templatePath: string): string {
	const basePath = getTemplateBasePath();
	const fullPath = path.join(basePath, templatePath);

	try {
		return readFileSync(fullPath, 'utf-8');
	} catch (err) {
		console.error(`[Templates] Error loading template: ${fullPath}`, err);
		return '';
	}
}

/**
 * Load the main email wrapper template
 */
export function loadEmailWrapperTemplate(): string {
	return loadTemplate('email/email.html');
}

/**
 * Load a backup notification EJS template
 * @param templateName - Name of the template file (e.g., 'BackupSuccessNotification.ejs')
 */
export function loadBackupTemplate(templateName: string): string {
	return loadTemplate(`email/backup/${templateName}`);
}
