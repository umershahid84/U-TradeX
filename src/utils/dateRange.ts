import { etClock } from './lateDay';
import { weekStart } from './winRate';

// Filters for lists of trades and orders. Days, weeks (Monday to Sunday), months and years follow the New York
// calendar, like the Stats tab.

export type RangeId = 'today' | 'week' | 'month' | '6m' | 'year' | 'all';

export const RANGES: { id: RangeId; label: string; title: string }[] = [
  { id: 'today', label: 'Today', title: 'Since midnight New York time' },
  { id: 'week', label: 'Week', title: 'Since Monday' },
  { id: 'month', label: 'Month', title: 'Since the 1st of this month' },
  { id: '6m', label: '6 months', title: 'The last six months' },
  { id: 'year', label: 'Year', title: 'Since January 1' },
  { id: 'all', label: 'All', title: 'Everything' },
];

/** First New York calendar date (YYYY-MM-DD) included in a range */
export const rangeStartDate = (id: RangeId, now = Date.now()): string => {
  const today = etClock(now).date;
  if (id === 'all') return '0000-00-00';
  if (id === 'today') return today;
  if (id === 'week') return weekStart(today);
  if (id === 'month') return `${today.slice(0, 7)}-01`;
  if (id === 'year') return `${today.slice(0, 4)}-01-01`;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 6);
  return d.toISOString().slice(0, 10);
};

export const inRange = (ms: number, id: RangeId, now = Date.now()): boolean => etClock(ms).date >= rangeStartDate(id, now);

const dt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dty = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Nov 24, 1:32 PM" in New York time; the year is added for earlier years */
export const fmtDateTime = (ms: number, now = Date.now()): string =>
  etClock(ms).date.slice(0, 4) === etClock(now).date.slice(0, 4) ? dt.format(new Date(ms)) : dty.format(new Date(ms));
