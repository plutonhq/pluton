import { readFileSync } from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { configService } from '../services/ConfigService';

export abstract class BaseNotification {
	protected subject: string = '';
	protected contentType: string = 'html';
	protected content: string = '';
	protected timestamp: Date;
	protected type: 'success' | 'error' | 'info' | 'warning' | 'test' = 'test';

	constructor() {
		this.timestamp = new Date();
	}

	getSubject(): string {
		return this.subject;
	}

	getContent(): string {
		return this.content;
	}

	getTimestamp(): Date {
		return this.timestamp;
	}

	getType(): string {
		return this.type;
	}

	protected loadEmailTemplate(): string {
		try {
			// Get the path to the email template
			// const __filename = fileURLToPath(import.meta.url);
			// const __dirname = dirname(__filename);
			// return readFileSync(path.join(__dirname, 'templates', 'email', 'email.html'), {
			// 	encoding: 'utf-8',
			// });
			const templatePath = path.join(
				process.cwd(),
				'src',
				'notifications',
				'templates',
				'email',
				'email.html'
			);
			console.log('💌 template Path :', templatePath);
			return readFileSync(templatePath, 'utf-8');
		} catch (err) {
			console.log('Error loading email template:', err);
			return ''; // Fallback to empty string if file read fails
		}
	}

	protected applyEmailTemplate(
		content: string,
		data: {
			appTitle: string;
			preHeader?: string;
			className?: string;
		}
	): string {
		let emailTemplate = this.loadEmailTemplate();
		if (!emailTemplate) return content;

		// Generate Current Date
		const currentDate = new Date().toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		});

		return emailTemplate
			.replace('{{CLASSNAME}}', data.className || '')
			.replace('{{APP_TITLE}}', data.appTitle)
			.replace('{{CURRENT_DATE}}', currentDate)
			.replace('{{APP_URL}}', configService.config.APP_URL || '')
			.replace('{{PRE_HEADER}}', data.preHeader || '')
			.replace('{{EMAIL_BODY_CONTENT}}', content);
	}

	protected buildContent(data: Record<string, any>): string {
		// Override in specific notification classes
		return '';
	}
}
