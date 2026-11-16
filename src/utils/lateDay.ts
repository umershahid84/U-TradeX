import { ChartData } from '../types';

/**
 * Late-day pressure: a proxy read of which way the last hour of the regular session is leaning, built from
 * price, volume and VWAP. It is NOT the exchange closing-auction (MOC) imbalance, which needs a paid NYSE /
 * Nasdaq feed that this app does not have.
 */
export interface LateDayRead {
  /** -100 (selling) to +100 (buying) */
  score: number;
  label: 'Buy pressure' | 'Sell pressure' | 'Balanced';
  /** Volume in the last hour vs the same clock hour on previous sessions; null without history */
  volumeRatio: number | null;
  /** Price change over the window, % */
  driftPct: number;
  /** Price vs the day's VWAP, % */
  vwapDevPct: number;
  /** Where price sits in the day's range, 0 (low) to 1 (high) */
  rangePos: number;
  /** Time of the last bar used (ms) */
  asOf: number;
  /** 'live' while the session is open, 'close' once it has ended */
  phase: 'live' | 'close';
  heavyVolume: boolean;
  /** Regular-session days of history used for the volume baseline */
  baselineDays: number;
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** New York calendar date and minutes since midnight for a timestamp */
export const etClock = (ms: number): { date: string; minutes: number; weekday: number } => {
  const p: Record<string, string> = {};
  fmt.formatToParts(new Date(ms)).forEach((x) => x.type !== 'literal' && (p[x.type] = x.value));
  const date = `${p.year}-${p.month}-${p.day}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, minutes: +p.hour * 60 + +p.minute, weekday };
};

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const WINDOW_MIN = 60;
const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

/** Bars should be intraday (1m to 15m), covering several sessions; only regular-session bars are used */
export const lateDayPressure = (bars: ChartData[], now = Date.now()): LateDayRead | null => {
  const regular = bars.filter((b) => {
    const m = etClock(b.time).minutes;
    return m >= OPEN && m < CLOSE;
  });
  if (!regular.length) return null;

  const byDay = new Map<string, ChartData[]>();
  for (const b of regular) {
    const d = etClock(b.time).date;
    byDay.set(d, [...(byDay.get(d) ?? []), b]);
  }
  const days = [...byDay.keys()].sort();
  const today = byDay.get(days[days.length - 1])!;
  if (today.length < 6) return null;

  const last = today[today.length - 1];
  const barMs = today.length > 1 ? Math.max(60_000, today[1].time - today[0].time) : 300_000;
  const end = last.time + barMs;
  const start = end - WINDOW_MIN * 60_000;
  const windowBars = today.filter((b) => b.time >= start);
  if (windowBars.length < 3) return null;

  const price = last.close;
  const startPrice = windowBars[0].open;
  const high = Math.max(...today.map((b) => b.high));
  const low = Math.min(...today.map((b) => b.low));
  let pv = 0, vol = 0;
  for (const b of today) {
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    vol += b.volume;
  }
  const vwap = vol > 0 ? pv / vol : price;

  const driftPct = (price / startPrice - 1) * 100;
  const vwapDevPct = (price / vwap - 1) * 100;
  const rangePos = high > low ? (price - low) / (high - low) : 0.5;
  const rangePct = Math.max(0.05, ((high - low) / price) * 100);

  // same clock window on the previous sessions
  const startClock = etClock(start).minutes;
  const endClock = etClock(end - 1).minutes;
  const windowVol = windowBars.reduce((s, b) => s + b.volume, 0);
  const past: number[] = [];
  for (const d of days.slice(0, -1).slice(-4)) {
    const v = byDay.get(d)!.filter((b) => {
      const m = etClock(b.time).minutes;
      return m >= startClock && m <= endClock;
    });
    if (v.length >= 3) past.push(v.reduce((s, b) => s + b.volume, 0));
  }
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0;
  const volumeRatio = avg > 0 ? windowVol / avg : null;

  const a = clamp((driftPct / rangePct) * 2);
  const b = clamp((vwapDevPct / rangePct) * 2);
  const c = (rangePos - 0.5) * 2;
  const mult = volumeRatio == null ? 1 : clamp(0.7 + 0.3 * volumeRatio, 0.7, 1.3);
  const score = Math.round(clamp((0.4 * a + 0.3 * b + 0.3 * c) * mult) * 100);

  const lastDay = days[days.length - 1];
  const nowEt = etClock(now);
  const phase = nowEt.date !== lastDay || nowEt.minutes >= CLOSE ? 'close' : 'live';

  return {
    score,
    label: score >= 35 ? 'Buy pressure' : score <= -35 ? 'Sell pressure' : 'Balanced',
    volumeRatio,
    driftPct,
    vwapDevPct,
    rangePos,
    asOf: last.time,
    phase,
    heavyVolume: volumeRatio != null && volumeRatio >= 1.5,
    baselineDays: past.length,
  };
};
