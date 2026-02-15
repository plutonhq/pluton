import { configService } from '../services/ConfigService';
import { loadEmailWrapperTemplate } from './templateLoader';

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
		return loadEmailWrapperTemplate();
	}

	protected applyEmailTemplate(
		content: string,
		data: {
			appTitle: string;
			preHeader?: string;
			className?: string;
		}
	): string {
		const emailTemplate = this.loadEmailTemplate();
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
