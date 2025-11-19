import { formatDuration, formatBytes, formatNumberToK } from '../../src/utils/formatter';

describe('formatDuration', () => {
	describe('zero and falsy values', () => {
		it('should return "0s" when seconds is 0', () => {
			expect(formatDuration(0)).toBe('0s');
		});

		it('should return "0s" when seconds is null or undefined', () => {
			expect(formatDuration(null as any)).toBe('0s');
			expect(formatDuration(undefined as any)).toBe('0s');
		});
	});

	describe('milliseconds (values less than 1 second)', () => {
		it('should format values less than 1 second as milliseconds', () => {
			expect(formatDuration(0.5)).toBe('500ms');
			expect(formatDuration(0.123)).toBe('123ms');
			expect(formatDuration(0.999)).toBe('999ms');
		});

		it('should round milliseconds to nearest integer', () => {
			expect(formatDuration(0.5555)).toBe('556ms');
			expect(formatDuration(0.4444)).toBe('444ms');
		});

		it('should handle very small values', () => {
			expect(formatDuration(0.001)).toBe('1ms');
			expect(formatDuration(0.0001)).toBe('0ms');
		});
	});

	describe('seconds only (1-59 seconds)', () => {
		it('should format seconds correctly', () => {
			expect(formatDuration(1)).toBe('1s');
			expect(formatDuration(30)).toBe('30s');
			expect(formatDuration(59)).toBe('59s');
		});

		it('should floor decimal seconds', () => {
			expect(formatDuration(5.9)).toBe('5s');
			expect(formatDuration(59.99)).toBe('59s');
		});
	});

	describe('minutes only (1-59 minutes)', () => {
		it('should format minutes correctly without showing seconds', () => {
			expect(formatDuration(60)).toBe('1 min');
			expect(formatDuration(120)).toBe('2 min');
			expect(formatDuration(1800)).toBe('30 min');
			expect(formatDuration(3540)).toBe('59 min');
		});

		it('should ignore remaining seconds when displaying minutes', () => {
			expect(formatDuration(90)).toBe('1 min');
			expect(formatDuration(119)).toBe('1 min');
			expect(formatDuration(150)).toBe('2 min');
		});
	});

	describe('hours and minutes', () => {
		it('should format hours and minutes correctly', () => {
			expect(formatDuration(3600)).toBe('1 h 0 min');
			expect(formatDuration(3660)).toBe('1 h 1 min');
			expect(formatDuration(7200)).toBe('2 h 0 min');
			expect(formatDuration(7320)).toBe('2 h 2 min');
		});

		it('should handle large hour values', () => {
			expect(formatDuration(36000)).toBe('10 h 0 min');
			expect(formatDuration(86400)).toBe('24 h 0 min');
		});

		it('should ignore remaining seconds when displaying hours', () => {
			expect(formatDuration(3661)).toBe('1 h 1 min');
			expect(formatDuration(3659)).toBe('1 h 0 min');
		});
	});

	describe('boundary values', () => {
		it('should correctly handle transition from seconds to minutes', () => {
			expect(formatDuration(59)).toBe('59s');
			expect(formatDuration(60)).toBe('1 min');
		});

		it('should correctly handle transition from minutes to hours', () => {
			expect(formatDuration(3599)).toBe('59 min');
			expect(formatDuration(3600)).toBe('1 h 0 min');
		});

		it('should correctly handle transition from milliseconds to seconds', () => {
			expect(formatDuration(0.999)).toBe('999ms');
			expect(formatDuration(1)).toBe('1s');
		});
	});

	describe('decimal and fractional values', () => {
		it('should floor all time components', () => {
			expect(formatDuration(3661.9)).toBe('1 h 1 min');
			expect(formatDuration(125.7)).toBe('2 min');
			expect(formatDuration(45.8)).toBe('45s');
		});
	});

	describe('edge cases and special values', () => {
		it('should handle negative values', () => {
			expect(formatDuration(-10)).toBe('-10000ms');
			expect(formatDuration(-0.5)).toBe('-500ms');
		});

		it('should handle very large values', () => {
			expect(formatDuration(100000)).toBe('27 h 46 min');
			expect(formatDuration(1000000)).toBe('277 h 46 min');
		});

		it('should handle NaN', () => {
			expect(formatDuration(NaN)).toBe('0s');
		});

		it('should handle Infinity', () => {
			expect(formatDuration(Infinity)).toBe('Infinity h NaN min');
		});
	});
});

describe('formatBytes', () => {
	describe('zero and small values', () => {
		it('should return "0.00 B" for 0', () => {
			expect(formatBytes(0)).toBe('0.00 B');
		});

		it('should format bytes correctly', () => {
			expect(formatBytes(1)).toBe('1.00 B');
			expect(formatBytes(100)).toBe('100.00 B');
			expect(formatBytes(1023)).toBe('1023.00 B');
		});

		it('should handle null and undefined', () => {
			expect(formatBytes(null as any)).toBe('0.00 B');
			expect(formatBytes(undefined as any)).toBe('0.00 B');
		});
	});

	describe('kilobytes', () => {
		it('should format kilobytes correctly', () => {
			expect(formatBytes(1024)).toBe('1.00 KB');
			expect(formatBytes(2048)).toBe('2.00 KB');
			expect(formatBytes(1536)).toBe('1.50 KB');
		});

		it('should round to 2 decimal places', () => {
			expect(formatBytes(1500)).toBe('1.46 KB');
			expect(formatBytes(2500)).toBe('2.44 KB');
		});
	});

	describe('megabytes', () => {
		it('should format megabytes correctly', () => {
			expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
			expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
		});

		it('should handle decimal megabytes', () => {
			expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.50 MB');
			expect(formatBytes(10.25 * 1024 * 1024)).toBe('10.25 MB');
		});
	});

	describe('gigabytes', () => {
		it('should format gigabytes correctly', () => {
			expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
			expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
		});

		it('should handle large gigabyte values', () => {
			expect(formatBytes(100 * 1024 * 1024 * 1024)).toBe('100.00 GB');
			expect(formatBytes(999.99 * 1024 * 1024 * 1024)).toBe('999.99 GB');
		});
	});

	describe('terabytes', () => {
		it('should format terabytes correctly', () => {
			expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
			expect(formatBytes(5.5 * 1024 * 1024 * 1024 * 1024)).toBe('5.50 TB');
		});

		it('should handle large terabyte values', () => {
			expect(formatBytes(100 * 1024 * 1024 * 1024 * 1024)).toBe('100.00 TB');
		});
	});

	describe('petabytes', () => {
		it('should format petabytes correctly', () => {
			expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1.00 PB');
			expect(formatBytes(2.5 * 1024 * 1024 * 1024 * 1024 * 1024)).toBe('2.50 PB');
		});

		it('should cap at petabytes for very large values', () => {
			const veryLarge = 1000 * 1024 * 1024 * 1024 * 1024 * 1024;
			expect(formatBytes(veryLarge)).toBe('1000.00 PB');
		});
	});

	describe('boundary values', () => {
		it('should correctly handle unit boundaries', () => {
			expect(formatBytes(1023)).toBe('1023.00 B');
			expect(formatBytes(1024)).toBe('1.00 KB');
			expect(formatBytes(1024 * 1024 - 1)).toBe('1024.00 KB');
			expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
		});
	});

	describe('precision and rounding', () => {
		it('should always show 2 decimal places', () => {
			expect(formatBytes(1234)).toBe('1.21 KB');
			expect(formatBytes(1234567)).toBe('1.18 MB');
			expect(formatBytes(1234567890)).toBe('1.15 GB');
		});

		it('should round correctly', () => {
			expect(formatBytes(1025)).toBe('1.00 KB');
			expect(formatBytes(1126)).toBe('1.10 KB');
		});
	});

	describe('negative and edge cases', () => {
		it('should handle negative values', () => {
			// formatBytes doesn't convert negative values correctly since it checks >= 1024
			// Negative values stay in bytes
			expect(formatBytes(-1024)).toBe('-1024.00 B');
		});

		it('should handle NaN', () => {
			expect(formatBytes(NaN)).toBe('0.00 B');
		});
	});
});

describe('formatNumberToK', () => {
	describe('numbers less than 1000', () => {
		it('should return the number as string', () => {
			expect(formatNumberToK(0)).toBe('0');
			expect(formatNumberToK(1)).toBe('1');
			expect(formatNumberToK(99)).toBe('99');
			expect(formatNumberToK(999)).toBe('999');
		});

		it('should handle negative numbers less than 1000', () => {
			expect(formatNumberToK(-500)).toBe('-500');
			expect(formatNumberToK(-999)).toBe('-999');
		});
	});

	describe('numbers 1000 and above', () => {
		it('should format thousands with k suffix', () => {
			expect(formatNumberToK(1000)).toBe('1.0k');
			expect(formatNumberToK(1500)).toBe('1.5k');
			expect(formatNumberToK(2000)).toBe('2.0k');
		});

		it('should show 1 decimal place', () => {
			expect(formatNumberToK(1234)).toBe('1.2k');
			expect(formatNumberToK(5678)).toBe('5.7k');
			expect(formatNumberToK(9999)).toBe('10.0k');
		});

		it('should handle large numbers', () => {
			expect(formatNumberToK(10000)).toBe('10.0k');
			expect(formatNumberToK(100000)).toBe('100.0k');
			expect(formatNumberToK(1000000)).toBe('1000.0k');
		});
	});

	describe('decimal and fractional values', () => {
		it('should handle decimal input', () => {
			expect(formatNumberToK(1500.5)).toBe('1.5k');
			expect(formatNumberToK(2750.9)).toBe('2.8k');
		});

		it('should round to 1 decimal place', () => {
			expect(formatNumberToK(1234.5)).toBe('1.2k');
			expect(formatNumberToK(1567.8)).toBe('1.6k');
		});
	});

	describe('boundary values', () => {
		it('should correctly handle the 999-1000 boundary', () => {
			expect(formatNumberToK(999)).toBe('999');
			expect(formatNumberToK(1000)).toBe('1.0k');
		});

		it('should handle values just below 1000', () => {
			expect(formatNumberToK(999.9)).toBe('999.9');
			expect(formatNumberToK(999.1)).toBe('999.1');
		});
	});

	describe('edge cases', () => {
		it('should handle zero', () => {
			expect(formatNumberToK(0)).toBe('0');
		});

		it('should handle negative large numbers', () => {
			// Negative numbers are less than 1000, so they don't get the 'k' suffix
			expect(formatNumberToK(-1000)).toBe('-1000');
			expect(formatNumberToK(-5000)).toBe('-5000');
		});

		it('should handle very large numbers', () => {
			expect(formatNumberToK(1000000)).toBe('1000.0k');
			expect(formatNumberToK(999999)).toBe('1000.0k');
		});

		it('should handle NaN', () => {
			// NaN < 1000 is false, so it goes through the division
			expect(formatNumberToK(NaN)).toBe('NaNk');
		});

		it('should throw error for null', () => {
			// null.toString() throws an error
			expect(() => formatNumberToK(null as any)).toThrow();
		});
	});
});
