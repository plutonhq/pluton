import type { ErrorRequestHandler, Express } from 'express';
import path from 'path';
/** Public static SPA entry only; registered API handlers remain ahead of this fallback. */
export function registerSpaFallback(app: Express, publicPath: string) {
	// Unknown API routes and uncaught API errors must never become a successful
	// SPA document (or Express's default HTML error page). Do not expose raw errors.
	const apiError: ErrorRequestHandler = (error, _req, res, next) => {
		if (res.headersSent) return next(error);
		const status = error?.statusCode ?? error?.status;
		const code = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
		res.status(code).json({
			success: false,
			error: code === 400 ? 'Invalid API request.' : 'API request could not be completed.',
		});
	};
	app.use('/api', apiError);
	app.use('/api', (_req, res) => {
		res.status(404).json({ success: false, error: 'API route not found.' });
	});
	app.get(['/docs', '/docs/{*path}'], (req, res) => {
		// Real docs assets are served by express.static first. Never return HTML for
		// a missing module/index/license, or interpret a request path as a file path.
		if (
			req.path.startsWith('/docs/assets/') ||
			req.path.startsWith('/docs/licenses/') ||
			path.posix.basename(req.path).includes('.')
		) {
			res.sendStatus(404);
			return;
		}
		res.sendFile(path.join(publicPath, 'docs', 'index.html'));
	});
	app.get('{*path}', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')));
}
