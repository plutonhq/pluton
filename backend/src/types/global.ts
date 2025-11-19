export interface SystemJobConfig {
	name: string;
	schedule: string; // Cron pattern
	payload?: any;
	maxAttempts?: number; // Optional: Override the default
	retryDelay?: number; // Optional: Override the default
}
