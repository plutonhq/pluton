/**
 * Formats a duration in seconds to a human-readable string.
 *
 * @param seconds - The duration in seconds to format
 * @returns A formatted string representing the duration (e.g., "2 h 30 min", "45 min", "30s", "500ms")
 *
 * @example
 * formatDuration(0.5) // "500ms"
 * formatDuration(45) // "45s"
 * formatDuration(120) // "2 min"
 * formatDuration(7200) // "2 h 0 min"
 */
export const formatDuration = (seconds: number): string => {
	if (!seconds) return '0s';

	if (seconds < 1) {
		return `${Math.round(seconds * 1000)}ms`;
	}

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);

	if (hours >= 1) {
		return `${hours} h ${minutes} min`;
	}

	if (minutes >= 1) {
		return `${minutes} min`;
	}

	return `${remainingSeconds}s`;
};

/**
 * Formats a byte size to a human-readable string with appropriate units.
 *
 * @param bytes - The size in bytes to format
 * @returns A formatted string with the size and unit (e.g., "1.50 KB", "2.00 GB")
 *
 * @example
 * formatBytes(500) // "500.00 B"
 * formatBytes(1536) // "1.50 KB"
 * formatBytes(1048576) // "1.00 MB"
 * formatBytes(1073741824) // "1.00 GB"
 */
export const formatBytes = (bytes: number): string => {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let value = bytes || 0;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}

	return `${value.toFixed(2)} ${units[unitIndex]}`;
};

/**
 * Formats a number to a compact string representation with 'k' suffix for thousands.
 *
 * @param num - The number to format
 * @returns A formatted string (e.g., "999", "1.5k", "10.0k")
 *
 * @example
 * formatNumberToK(500) // "500"
 * formatNumberToK(1500) // "1.5k"
 * formatNumberToK(10000) // "10.0k"
 */
export const formatNumberToK = (num: number): string => {
	if (num < 1000) return num.toString();
	const value = num / 1000;
	return `${value.toFixed(1)}k`;
};
