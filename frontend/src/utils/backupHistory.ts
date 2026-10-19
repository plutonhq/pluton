export const HISTORY_PAGE_SIZES = [10, 20, 50] as const;
export type HistoryState = {
   page: number;
   pageSize: (typeof HISTORY_PAGE_SIZES)[number];
   startDate: string;
   endDate: string;
   timeZone: string;
};
export type HistoryPage<T> = {
   items: T[];
   page: number;
   pageSize: HistoryState['pageSize'];
   total: number;
   totalPages: number;
   hasPrevious: boolean;
   hasNext: boolean;
   timeZone: string;
};

export function displayTimeZone(): string {
   return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function readHistoryState(params: URLSearchParams, localZone = displayTimeZone()): HistoryState {
   const page = params.get('historyPage') || '1';
   const size = Number(params.get('historyPageSize'));
   const timeZone = params.get('historyTimeZone') || localZone;
   let validZone = localZone;
   try {
      new Intl.DateTimeFormat('en', { timeZone });
      validZone = timeZone;
   } catch {
      /* Ignore malformed URL preferences, not API validation. */
   }
   return {
      page: /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
      pageSize: HISTORY_PAGE_SIZES.includes(size as HistoryState['pageSize']) ? (size as HistoryState['pageSize']) : 10,
      startDate: params.get('historyStart') || '',
      endDate: params.get('historyEnd') || '',
      timeZone: validZone,
   };
}

/** Preserve unrelated plan URL state; never place record credentials in URLs. */
export function writeHistoryState(params: URLSearchParams, state: HistoryState): URLSearchParams {
   const next = new URLSearchParams(params);
   const values = {
      historyPage: String(state.page),
      historyPageSize: String(state.pageSize),
      historyStart: state.startDate,
      historyEnd: state.endDate,
      historyTimeZone: state.timeZone,
   };
   for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
   }
   return next;
}

export function historyApiQuery(state: HistoryState): URLSearchParams {
   const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize), timeZone: state.timeZone });
   if (state.startDate) params.set('startDate', state.startDate);
   if (state.endDate) params.set('endDate', state.endDate);
   return params;
}

export function validateHistoryDates(startDate: string, endDate: string): string | undefined {
   for (const value of [startDate, endDate]) {
      if (!value) continue;
      const date = new Date(`${value}T00:00:00.000Z`);
      if (
         !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
         value < '0001-01-01' ||
         value > '9998-12-31' ||
         !Number.isFinite(date.getTime()) ||
         date.toISOString().slice(0, 10) !== value
      )
         return 'Enter valid calendar dates.';
   }
   return startDate && endDate && endDate < startDate ? 'End date must be on or after start date.' : undefined;
}

export function historyPreset(days: 1 | 7 | 30, timeZone: string, now = new Date()) {
   const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
   const part = (name: string) => parts.find((item) => item.type === name)!.value;
   const endDate = `${part('year')}-${part('month')}-${part('day')}`;
   // Calendar arithmetic, not subtracting elapsed 24-hour periods in the user's zone.
   const date = new Date(`${endDate}T00:00:00.000Z`);
   date.setUTCDate(date.getUTCDate() - days + 1);
   return { startDate: date.toISOString().slice(0, 10), endDate };
}

export function historyIsoDate(value?: string | number): string | undefined {
   if (value === undefined || !Number.isFinite(new Date(value).getTime())) return undefined;
   return new Date(value).toISOString();
}

export function formatHistoryDate(value: string | number | undefined, timeZone: string): string {
   if (!historyIsoDate(value)) return 'Not recorded';
   return new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
      new Date(value!),
   );
}

export function historyRange(page: number, pageSize: number, total: number): string {
   return `Showing ${total ? ((page - 1) * pageSize + 1).toLocaleString('en') : 0}–${Math.min(page * pageSize, total).toLocaleString('en')} of ${total.toLocaleString('en')} matching backups`;
}
