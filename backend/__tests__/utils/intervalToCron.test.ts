import { intervalToCron, getIntervalLabel } from '../../src/utils/intervalToCron';
import { PlanInterval } from '../../src/types/plans';

describe('intervalToCron', () => {
	describe('hourly intervals', () => {
		it('should return cron for hourly interval', () => {
			const interval: PlanInterval = { type: 'hourly' };
			expect(intervalToCron(interval)).toBe('0 * * * *');
		});
	});

	describe('hours intervals', () => {
		it('should return cron for every 1 hour', () => {
			const interval: PlanInterval = { type: 'hours', hours: '1' };
			expect(intervalToCron(interval)).toBe('0 */1 * * *');
		});

		it('should return cron for every 2 hours', () => {
			const interval: PlanInterval = { type: 'hours', hours: '2' };
			expect(intervalToCron(interval)).toBe('0 */2 * * *');
		});

		it('should return cron for every 6 hours', () => {
			const interval: PlanInterval = { type: 'hours', hours: '6' };
			expect(intervalToCron(interval)).toBe('0 */6 * * *');
		});

		it('should return cron for every 12 hours', () => {
			const interval: PlanInterval = { type: 'hours', hours: '12' };
			expect(intervalToCron(interval)).toBe('0 */12 * * *');
		});

		it('should default to 1 hour when hours is not specified', () => {
			const interval: PlanInterval = { type: 'hours' };
			expect(intervalToCron(interval)).toBe('0 */1 * * *');
		});
	});

	describe('minutes intervals', () => {
		it('should return cron for every 5 minutes', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 5 };
			expect(intervalToCron(interval)).toBe('*/5 * * * *');
		});

		it('should return cron for every 10 minutes', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 10 };
			expect(intervalToCron(interval)).toBe('*/10 * * * *');
		});

		it('should return cron for every 15 minutes', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 15 };
			expect(intervalToCron(interval)).toBe('*/15 * * * *');
		});

		it('should return cron for every 30 minutes', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 30 };
			expect(intervalToCron(interval)).toBe('*/30 * * * *');
		});

		it('should default to 5 minutes when minutes is not specified', () => {
			const interval: PlanInterval = { type: 'minutes' };
			expect(intervalToCron(interval)).toBe('*/5 * * * *');
		});
	});

	describe('daily intervals', () => {
		it('should return cron for daily at midnight', () => {
			const interval: PlanInterval = { type: 'daily', time: '12:00AM' };
			expect(intervalToCron(interval)).toBe('00 12 * * *');
		});

		it('should return cron for daily at 9:00 AM', () => {
			const interval: PlanInterval = { type: 'daily', time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 * * *');
		});

		it('should return cron for daily at 3:30 PM', () => {
			const interval: PlanInterval = { type: 'daily', time: '3:30PM' };
			expect(intervalToCron(interval)).toBe('30 15 * * *');
		});

		it('should return cron for daily at 11:59 PM', () => {
			const interval: PlanInterval = { type: 'daily', time: '11:59PM' };
			expect(intervalToCron(interval)).toBe('59 23 * * *');
		});

		it('should handle lowercase am/pm', () => {
			const interval: PlanInterval = { type: 'daily', time: '6:45pm' };
			expect(intervalToCron(interval)).toBe('45 18 * * *');
		});

		it('should default to midnight when time is not specified', () => {
			const interval: PlanInterval = { type: 'daily' };
			expect(intervalToCron(interval)).toBe('0 0 * * *');
		});
	});

	describe('weekly intervals', () => {
		it('should return cron for weekly on Sunday', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'sun', time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 * * 0');
		});

		it('should return cron for weekly on Monday', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'mon', time: '10:30AM' };
			expect(intervalToCron(interval)).toBe('30 10 * * 1');
		});

		it('should return cron for multiple days', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'mon,wed,fri', time: '8:00AM' };
			expect(intervalToCron(interval)).toBe('00 8 * * 1,3,5');
		});

		it('should return cron for all weekdays', () => {
			const interval: PlanInterval = {
				type: 'weekly',
				days: 'mon,tue,wed,thu,fri',
				time: '9:00AM',
			};
			expect(intervalToCron(interval)).toBe('00 9 * * 1,2,3,4,5');
		});

		it('should return cron for weekend days', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'sat,sun', time: '10:00AM' };
			expect(intervalToCron(interval)).toBe('00 10 * * 6,0');
		});

		it('should default to Sunday when days is not specified', () => {
			const interval: PlanInterval = { type: 'weekly', time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 * * 0');
		});
	});

	describe('days intervals (alias for weekly)', () => {
		it('should handle days type same as weekly', () => {
			const interval: PlanInterval = { type: 'days', days: 'tue,thu', time: '2:00PM' };
			expect(intervalToCron(interval)).toBe('00 14 * * 2,4');
		});
	});

	describe('monthly intervals', () => {
		it('should return cron for first day of month', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'first', time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 1 * *');
		});

		it('should return cron for middle of month', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'middle', time: '3:00PM' };
			expect(intervalToCron(interval)).toBe('00 15 15 * *');
		});

		it('should return cron for last day of month', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'last', time: '11:30PM' };
			expect(intervalToCron(interval)).toBe('30 23 L * *');
		});

		it('should default to first day when days is not specified', () => {
			const interval: PlanInterval = { type: 'monthly', time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 1 * *');
		});

		it('should default to first day for unknown days value', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'unknown' as any, time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 1 * *');
		});
	});

	describe('time parsing', () => {
		it('should handle 12:00 PM correctly', () => {
			const interval: PlanInterval = { type: 'daily', time: '12:00PM' };
			expect(intervalToCron(interval)).toBe('00 24 * * *');
		});

		it('should handle 12:00 AM correctly', () => {
			const interval: PlanInterval = { type: 'daily', time: '12:00AM' };
			expect(intervalToCron(interval)).toBe('00 12 * * *');
		});

		it('should handle 1:00 AM correctly', () => {
			const interval: PlanInterval = { type: 'daily', time: '1:00AM' };
			expect(intervalToCron(interval)).toBe('00 1 * * *');
		});

		it('should handle 1:00 PM correctly', () => {
			const interval: PlanInterval = { type: 'daily', time: '1:00PM' };
			expect(intervalToCron(interval)).toBe('00 13 * * *');
		});

		it('should handle mixed case AM/PM', () => {
			const interval1: PlanInterval = { type: 'daily', time: '5:30Am' };
			expect(intervalToCron(interval1)).toBe('30 5 * * *');

			const interval2: PlanInterval = { type: 'daily', time: '5:30Pm' };
			expect(intervalToCron(interval2)).toBe('30 17 * * *');
		});
	});

	describe('edge cases', () => {
		it('should handle invalid time format gracefully', () => {
			const interval: PlanInterval = { type: 'daily', time: 'invalid' };
			expect(intervalToCron(interval)).toBe('0 0 * * *');
		});

		it('should return default cron for unknown interval type', () => {
			const interval: PlanInterval = { type: 'unknown' as any };
			expect(intervalToCron(interval)).toBe('0 0 * * *');
		});

		it('should handle empty days string', () => {
			const interval: PlanInterval = { type: 'weekly', days: '', time: '9:00AM' };
			expect(intervalToCron(interval)).toBe('00 9 * * 0');
		});
	});
});

describe('getIntervalLabel', () => {
	describe('hourly intervals', () => {
		it('should return label for hourly', () => {
			const interval: PlanInterval = { type: 'hourly' };
			expect(getIntervalLabel(interval)).toBe('Runs Every Hour');
		});
	});

	describe('hours intervals', () => {
		it('should return label for 1 hour', () => {
			const interval: PlanInterval = { type: 'hours', hours: '1' };
			expect(getIntervalLabel(interval)).toBe('Runs Every Hour');
		});

		it('should return label for multiple hours', () => {
			const interval: PlanInterval = { type: 'hours', hours: '2' };
			expect(getIntervalLabel(interval)).toBe('Runs Every 2 Hours');
		});

		it('should return label for 6 hours', () => {
			const interval: PlanInterval = { type: 'hours', hours: '6' };
			expect(getIntervalLabel(interval)).toBe('Runs Every 6 Hours');
		});

		it('should default to 1 hour when not specified', () => {
			const interval: PlanInterval = { type: 'hours' };
			expect(getIntervalLabel(interval)).toBe('Runs Every Hour');
		});
	});

	describe('minutes intervals', () => {
		it('should return label for 1 minute', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 1 };
			expect(getIntervalLabel(interval)).toBe('Runs Every Minute');
		});

		it('should return label for multiple minutes', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 5 };
			expect(getIntervalLabel(interval)).toBe('Runs Every 5 Minutes');
		});

		it('should return label for 30 minutes', () => {
			const interval: PlanInterval = { type: 'minutes', minutes: 30 };
			expect(getIntervalLabel(interval)).toBe('Runs Every 30 Minutes');
		});

		it('should default to 5 minutes when not specified', () => {
			const interval: PlanInterval = { type: 'minutes' };
			expect(getIntervalLabel(interval)).toBe('Runs Every 5 Minutes');
		});
	});

	describe('daily intervals', () => {
		it('should return label for daily', () => {
			const interval: PlanInterval = { type: 'daily' };
			expect(getIntervalLabel(interval)).toBe('Runs Once Daily');
		});
	});

	describe('weekly intervals', () => {
		it('should return label for single day', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'mon' };
			expect(getIntervalLabel(interval)).toBe('Runs Once Per Week on Monday');
		});

		it('should return label for each day of week', () => {
			expect(getIntervalLabel({ type: 'weekly', days: 'sun' })).toBe(
				'Runs Once Per Week on Sunday'
			);
			expect(getIntervalLabel({ type: 'weekly', days: 'mon' })).toBe(
				'Runs Once Per Week on Monday'
			);
			expect(getIntervalLabel({ type: 'weekly', days: 'tue' })).toBe(
				'Runs Once Per Week on Tuesday'
			);
			expect(getIntervalLabel({ type: 'weekly', days: 'wed' })).toBe(
				'Runs Once Per Week on Wednesday'
			);
			expect(getIntervalLabel({ type: 'weekly', days: 'thu' })).toBe(
				'Runs Once Per Week on Thursday'
			);
			expect(getIntervalLabel({ type: 'weekly', days: 'fri' })).toBe(
				'Runs Once Per Week on Friday'
			);
			expect(getIntervalLabel({ type: 'weekly', days: 'sat' })).toBe(
				'Runs Once Per Week on Saturday'
			);
		});

		it('should return label for multiple days', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'mon,wed,fri' };
			expect(getIntervalLabel(interval)).toBe('Runs 3 Times Per Week');
		});

		it('should return label for all days', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'sun,mon,tue,wed,thu,fri,sat' };
			expect(getIntervalLabel(interval)).toBe('Runs Every Day');
		});

		it('should handle uppercase days', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'MON' };
			expect(getIntervalLabel(interval)).toBe('Runs Once Per Week on Monday');
		});

		it('should handle unknown day name', () => {
			const interval: PlanInterval = { type: 'weekly', days: 'xyz' };
			expect(getIntervalLabel(interval)).toBe('Runs Once Per Week on xyz');
		});
	});

	describe('days intervals (alias for weekly)', () => {
		it('should handle days type same as weekly', () => {
			const interval: PlanInterval = { type: 'days', days: 'tue,thu' };
			expect(getIntervalLabel(interval)).toBe('Runs 2 Times Per Week');
		});
	});

	describe('monthly intervals', () => {
		it('should return label for first day of month', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'first' };
			expect(getIntervalLabel(interval)).toBe('Runs Once at the Start of Every Month');
		});

		it('should return label for middle of month', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'middle' };
			expect(getIntervalLabel(interval)).toBe('Runs Once in the Middle of Every Month');
		});

		it('should return label for last day of month', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'last' };
			expect(getIntervalLabel(interval)).toBe('Runs Once at the End of Every Month');
		});

		it('should return default label for unknown days value', () => {
			const interval: PlanInterval = { type: 'monthly', days: 'unknown' as any };
			expect(getIntervalLabel(interval)).toBe('Runs Once Per Month');
		});

		it('should return default label when days not specified', () => {
			const interval: PlanInterval = { type: 'monthly' };
			expect(getIntervalLabel(interval)).toBe('Runs Once Per Month');
		});
	});

	describe('edge cases', () => {
		it('should return custom schedule for unknown type', () => {
			const interval: PlanInterval = { type: 'unknown' as any };
			expect(getIntervalLabel(interval)).toBe('Custom Schedule');
		});

		it('should handle empty days array', () => {
			const interval: PlanInterval = { type: 'weekly', days: '' };
			expect(getIntervalLabel(interval)).toMatch(/Runs Once Per Week on/);
		});
	});
});
