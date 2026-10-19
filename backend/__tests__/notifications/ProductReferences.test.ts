import fs from 'node:fs';
import path from 'node:path';
import ejs from 'ejs';
const templates = path.join(__dirname, '../../src/notifications/templates');
describe('self-hosted notification presentation', () => {
	it('keeps local dashboard/docs links without commercial CDN images or product navigation', () => {
		for (const file of fs.readdirSync(templates, { recursive: true }) as string[]) {
			if (!/\.(?:ejs|html)$/.test(file)) continue;
			expect(fs.readFileSync(path.join(templates, file), 'utf8')).not.toMatch(
				/https?:\/\/[^\s"<>]*(?:usepluton\.com|pluton\.b-cdn\.net)/i
			);
		}
		expect(fs.readFileSync(path.join(templates, 'email/email.html'), 'utf8')).toContain(
			'{{APP_URL}}/docs'
		);
	});
	it('renders actual legacy email statistics without mixing directories or inventing deletion counts', () => {
		const template = fs.readFileSync(
			path.join(templates, 'email/backup/BackupSuccessNotification.ejs'),
			'utf8'
		);
		const block = template.slice(
			template.indexOf('FILES CHANGED'),
			template.indexOf('<!-- Replication Failures Warning')
		);
		const html = ejs.render(block, {
			stats: { files_new: 2, dirs_new: 50, files_changed: 1, dirs_changed: 20 },
			formatNumberToK: (n: number) => String(n),
		});
		expect(html).toMatch(/backupDetailsValue">\s*2\s*<\/p>/);
		expect(html).toMatch(/backupDetailsValue">\s*1\s*<\/p>/);
		expect(html).toContain('Not measured');
		expect(template).not.toContain('stats?.dirs_new');
		expect(template).not.toContain('stats?.dirs_changed');
		expect(template).toContain('Logical Snapshot Size');
	});
});
