import { ClosedTrade } from '../types';
import { etClock } from './lateDay';

export type PeriodUnit = 'day' | 'week' | 'month' | 'year';

export interface Tally {
  trades: number;
  wins: number;
  losses: number;
  /** Closed at exactly zero profit */
  even: number;
  /** wins / trades, as a percent; null with no trades */
  winRate: number | null;
  pnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
}

export interface PeriodTally extends Tally {
  key: string;
  label: string;
  /** The trades in this period */
  list: ClosedTrade[];
}

export const tally = (trades: ClosedTrade[]): Tally => {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    even: trades.length - wins.length - losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    pnl: trades.reduce((s, t) => s + t.pnl, 0),
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
  };
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday of the week containing a New York calendar date (YYYY-MM-DD) */
export const weekStart = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};

/** Sortable key for the day, Monday-based week, month or year a time falls in (New York calendar, like the market) */
export const periodKey = (ms: number, unit: PeriodUnit): string => {
  const date = etClock(ms).date;
  if (unit === 'day') return date;
  if (unit === 'week') return weekStart(date);
  if (unit === 'month') return date.slice(0, 7);
  return date.slice(0, 4);
};

export const periodLabel = (key: string, unit: PeriodUnit, ref = Date.now()): string => {
  if (unit === 'year') return key;
  if (unit === 'month') return `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
  const d = new Date(`${key}T12:00:00Z`);
  // days and weeks from an earlier year say which year
  const old = key.slice(0, 4) !== etClock(ref).date.slice(0, 4);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${old ? `, ${d.getUTCFullYear()}` : ''}`;
  if (unit === 'day') return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${base}`;
  return `Week of ${base}`;
};

/** Win rate and counts for every day / week / month / year that has trades, newest first */
export const byPeriod = (trades: ClosedTrade[], unit: PeriodUnit): PeriodTally[] => {
  const groups = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const k = periodKey(t.closedAt, unit);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({ key, label: periodLabel(key, unit), list, ...tally(list) }));
};

/** Trades closed in the current day / week / month / year */
export const currentPeriod = (trades: ClosedTrade[], unit: PeriodUnit, now = Date.now()): Tally =>
  tally(trades.filter((t) => periodKey(t.closedAt, unit) === periodKey(now, unit)));

/** Share of trading days that ended in profit (days are New York calendar days with at least one closed trade) */
export const profitableDays = (trades: ClosedTrade[]): { days: number; green: number; pct: number | null } => {
  const days = byPeriod(trades, 'day');
  const green = days.filter((d) => d.pnl > 0).length;
  return { days: days.length, green, pct: days.length ? (green / days.length) * 100 : null };
};
