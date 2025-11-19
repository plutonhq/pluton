import { PlanInterval } from '../types/plans';

/**
 * Converts a PlanInterval object to a cron expression string.
 *
 * @param interval - The interval configuration object
 * @returns A cron expression string representing the schedule
 *
 * @example
 * intervalToCron({ type: 'hourly' }) // '0 * * * *'
 * intervalToCron({ type: 'daily', time: '2:00PM' }) // '0 14 * * *'
 */
export function intervalToCron(interval: PlanInterval): string {
	const [hours, minutes] = interval.time
		? interval.time.match(/(\d+):(\d+)([AaPp][Mm])/)?.slice(1, 3) || []
		: [];
	const isPM = interval.time?.toLowerCase().includes('pm');
	const hour = hours ? (isPM ? (parseInt(hours) + 12).toString() : hours) : '0';

	switch (interval.type) {
		case 'hourly':
			return '0 * * * *';

		case 'hours':
			const hourValue = parseInt(interval.hours || '1');
			return `0 */${hourValue} * * *`;

		case 'minutes':
			const minuteValue = interval.minutes || '5';
			return `*/${minuteValue} * * * *`;

		case 'daily':
			return `${minutes || '0'} ${hour} * * *`;

		case 'weekly':
		case 'days':
			const weekDays = convertDaysToDates(interval.days || 'sun');
			return `${minutes || '0'} ${hour} * * ${weekDays}`;

		case 'monthly':
			switch (interval.days) {
				case 'first':
					return `${minutes || '0'} ${hour} 1 * *`;
				case 'middle':
					return `${minutes || '0'} ${hour} 15 * *`;
				case 'last':
					return `${minutes || '0'} ${hour} L * *`;
				default:
					return `${minutes || '0'} ${hour} 1 * *`;
			}

		default:
			return '0 0 * * *';
	}
}

/**
 * Returns a human-readable label describing the schedule of a PlanInterval.
 *
 * @param interval - The interval configuration object
 * @returns A string label describing the schedule (e.g., 'Runs Every Hour', 'Runs Once Daily')
 *
 * @example
 * getIntervalLabel({ type: 'hourly' }) // 'Runs Every Hour'
 * getIntervalLabel({ type: 'weekly', days: 'mon' }) // 'Runs Once Per Week on Monday'
 */
export function getIntervalLabel(interval: PlanInterval): string {
	switch (interval.type) {
		case 'hourly':
			return 'Runs Every Hour';

		case 'hours':
			const hours = parseInt(interval.hours || '1');
			return hours === 1 ? 'Runs Every Hour' : `Runs Every ${hours} Hours`;

		case 'minutes':
			const minutes = parseInt(interval.minutes?.toString() || '5');
			return minutes === 1 ? 'Runs Every Minute' : `Runs Every ${minutes} Minutes`;

		case 'daily':
			return 'Runs Once Daily';

		case 'weekly':
		case 'days':
			const days = interval.days?.split(',') || [];
			if (days.length === 7) {
				return 'Runs Every Day';
			} else if (days.length === 1) {
				const dayMap: Record<string, string> = {
					sun: 'Sunday',
					mon: 'Monday',
					tue: 'Tuesday',
					wed: 'Wednesday',
					thu: 'Thursday',
					fri: 'Friday',
					sat: 'Saturday',
				};
				const dayName = dayMap[days[0].toLowerCase()] || days[0];
				return `Runs Once Per Week on ${dayName}`;
			} else {
				return `Runs ${days.length} Times Per Week`;
			}

		case 'monthly':
			switch (interval.days) {
				case 'first':
					return 'Runs Once at the Start of Every Month';
				case 'middle':
					return 'Runs Once in the Middle of Every Month';
				case 'last':
					return 'Runs Once at the End of Every Month';
				default:
					return 'Runs Once Per Month';
			}

		default:
			return 'Custom Schedule';
	}
}

/**
 * Converts day names (e.g., 'sun,mon') to cron day numbers (e.g., '0,1').
 *
 * @param days - Comma-separated day names (e.g., 'sun,mon')
 * @returns Comma-separated cron day numbers (e.g., '0,1')
 *
 * @example
 * convertDaysToDates('sun,mon') // '0,1'
 * convertDaysToDates('wed,thu') // '3,4'
 */
const convertDaysToDates = (days: string): string => {
	const dayMap: Record<string, number> = {
		sun: 0,
		mon: 1,
		tue: 2,
		wed: 3,
		thu: 4,
		fri: 5,
		sat: 6,
	};
	const selectedDays = days
		?.split(',')
		.map(day => dayMap[day.toLowerCase()])
		.filter(day => day !== undefined)
		.join(',');

	return selectedDays;
};
