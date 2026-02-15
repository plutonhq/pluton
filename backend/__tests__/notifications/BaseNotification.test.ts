import { BaseNotification } from '../../src/notifications/BaseNotification';
import { configService } from '../../src/services/ConfigService';
import { loadEmailWrapperTemplate } from '../../src/notifications/templateLoader';

// Mock dependencies
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_TITLE: 'Test App',
			APP_URL: 'http://test.com',
		},
	},
}));

// Concrete implementation for testing
class TestNotification extends BaseNotification {
	constructor(type?: 'success' | 'error' | 'info' | 'warning' | 'test') {
		super();
		this.subject = 'Test Subject';
		this.content = 'Test Content';
		if (type) {
			this.type = type;
		}
	}

	protected buildContent(data: Record<string, any>): string {
		return data.message || 'Default content';
	}

	public testLoadEmailTemplate() {
		return this.loadEmailTemplate();
	}

	public testApplyEmailTemplate(
		content: string,
		data: { appTitle: string; preHeader?: string; className?: string }
	) {
		return this.applyEmailTemplate(content, data);
	}
}

describe('BaseNotification', () => {
	let notification: TestNotification;
	const mockLoadEmailWrapperTemplate = loadEmailWrapperTemplate as jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		notification = new TestNotification();
	});

	describe('constructor', () => {
		it('should initialize with default values', () => {
			expect(notification.getSubject()).toBe('Test Subject');
			expect(notification.getContent()).toBe('Test Content');
			expect(notification.getType()).toBe('test');
			expect(notification.getTimestamp()).toBeInstanceOf(Date);
		});

		it('should set timestamp to current date', () => {
			const before = new Date();
			const newNotification = new TestNotification();
			const after = new Date();

			const timestamp = newNotification.getTimestamp();
			expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
		});

		it('should allow setting different types', () => {
			const successNotification = new TestNotification('success');
			expect(successNotification.getType()).toBe('success');

			const errorNotification = new TestNotification('error');
			expect(errorNotification.getType()).toBe('error');

			const warningNotification = new TestNotification('warning');
			expect(warningNotification.getType()).toBe('warning');
		});
	});

	describe('getters', () => {
		it('should return correct subject', () => {
			expect(notification.getSubject()).toBe('Test Subject');
		});

		it('should return correct content', () => {
			expect(notification.getContent()).toBe('Test Content');
		});

		it('should return correct timestamp', () => {
			const timestamp = notification.getTimestamp();
			expect(timestamp).toBeInstanceOf(Date);
		});

		it('should return correct type', () => {
			expect(notification.getType()).toBe('test');
		});
	});

	describe('loadEmailTemplate', () => {
		it('should load email template successfully', () => {
			const mockTemplate = '<html><body>{{EMAIL_BODY_CONTENT}}</body></html>';
			mockLoadEmailWrapperTemplate.mockReturnValue(mockTemplate);

			const result = notification.testLoadEmailTemplate();

			expect(result).toBe(mockTemplate);
			expect(mockLoadEmailWrapperTemplate).toHaveBeenCalled();
		});

		it('should return empty string when template is not available', () => {
			mockLoadEmailWrapperTemplate.mockReturnValue('');

			const result = notification.testLoadEmailTemplate();

			expect(result).toBe('');
		});

		it('should delegate to loadEmailWrapperTemplate', () => {
			const mockTemplate = '<html>Template</html>';
			mockLoadEmailWrapperTemplate.mockReturnValue(mockTemplate);

			notification.testLoadEmailTemplate();

			expect(mockLoadEmailWrapperTemplate).toHaveBeenCalled();
		});

		it('should handle template loader returning empty', () => {
			mockLoadEmailWrapperTemplate.mockReturnValue('');

			const result = notification.testLoadEmailTemplate();
			expect(result).toBe('');

			mockLoadEmailWrapperTemplate.mockReturnValue('');

			const result2 = notification.testLoadEmailTemplate();
			expect(result2).toBe('');
		});
	});

	describe('applyEmailTemplate', () => {
		const mockTemplate = `
			<html>
				<head><title>{{APP_TITLE}}</title></head>
				<body class="{{CLASSNAME}}">
					<div>{{PRE_HEADER}}</div>
					<div>{{CURRENT_DATE}}</div>
					<div>{{APP_URL}}</div>
					<div>{{EMAIL_BODY_CONTENT}}</div>
				</body>
			</html>
		`;

		beforeEach(() => {
			mockLoadEmailWrapperTemplate.mockReturnValue(mockTemplate);
		});

		it('should replace all placeholders correctly', () => {
			const content = '<p>Test email body</p>';
			const data = {
				appTitle: 'My App',
				preHeader: 'Test Pre-header',
				className: 'test-class',
			};

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toContain('My App');
			expect(result).toContain('Test Pre-header');
			expect(result).toContain('test-class');
			expect(result).toContain('<p>Test email body</p>');
			expect(result).toContain('http://test.com');
		});

		it('should use default values for optional parameters', () => {
			const content = '<p>Content</p>';
			const data = { appTitle: 'App' };

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toContain('App');
			expect(result).not.toContain('{{CLASSNAME}}');
			expect(result).not.toContain('{{PRE_HEADER}}');
		});

		it('should include current date', () => {
			const content = '<p>Content</p>';
			const data = { appTitle: 'App' };

			const result = notification.testApplyEmailTemplate(content, data);

			const currentDate = new Date().toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});

			expect(result).toContain(currentDate);
		});

		it('should use APP_URL from config service', () => {
			const content = '<p>Content</p>';
			const data = { appTitle: 'App' };

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toContain('http://test.com');
		});

		it('should return original content if template loading fails', () => {
			mockLoadEmailWrapperTemplate.mockReturnValue('');

			const content = '<p>Original content</p>';
			const data = { appTitle: 'App' };

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toBe(content);
		});

		it('should handle empty className', () => {
			const content = '<p>Content</p>';
			const data = { appTitle: 'App', className: '' };

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toContain('class=""');
		});

		it('should handle complex HTML content', () => {
			const content = `
				<div class="header">
					<h1>Welcome</h1>
				</div>
				<div class="body">
					<p>This is a <strong>test</strong> email.</p>
				</div>
			`;
			const data = { appTitle: 'App' };

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toContain(content);
		});

		it('should handle special characters in content', () => {
			const content = '<p>Special chars: &lt;, &gt;, &amp;</p>';
			const data = { appTitle: 'App & More' };

			const result = notification.testApplyEmailTemplate(content, data);

			expect(result).toContain(content);
			expect(result).toContain('App & More');
		});
	});

	describe('buildContent', () => {
		it('should build content with provided data', () => {
			const result = notification['buildContent']({ message: 'Custom message' });
			expect(result).toBe('Custom message');
		});

		it('should use default content when no data provided', () => {
			const result = notification['buildContent']({});
			expect(result).toBe('Default content');
		});
	});
});
