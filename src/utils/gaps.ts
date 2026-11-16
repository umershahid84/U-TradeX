import { ChartData } from '../types';
import { etClock } from './lateDay';

export interface Gap {
  dir: 'up' | 'down';
  /** The previous session's close and the next session's open: the two edges of the gap */
  prevClose: number;
  open: number;
  /** Size relative to the previous close, in percent (negative for a gap down) */
  pct: number;
  /** Opening bar of the session after the gap (ms) */
  startTime: number;
  /** Bar where price first traded back to the previous close, or null while the gap is open */
  endTime: number | null;
  filled: boolean;
  /** How much of the gap price has covered so far, 0 to 100 */
  fillPct: number;
}

export interface GapOptions {
  /** Smallest gap worth showing, in percent of the previous close */
  minPct: number;
  /** Previous close for the first session in the data, when the data holds only one session */
  prevCloseHint?: number | null;
}

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;

/**
 * Price gaps between one session's close and the next session's open. Intraday bars use the regular session
 * only (pre-market and after-hours moves are what create the gap), daily and longer bars use each bar's own
 * open against the bar before. A gap is filled once a later bar trades back through the previous close.
 */
export const findGaps = (bars: ChartData[], opts: GapOptions): Gap[] => {
  if (bars.length < 2) return [];
  const spacing = bars[1].time - bars[0].time;
  const intraday = spacing > 0 && spacing < 20 * 3_600_000;

  const days = new Map<string, ChartData[]>();
  for (const b of bars) {
    const e = etClock(b.time);
    if (intraday && (e.minutes < OPEN || e.minutes >= CLOSE)) continue;
    days.set(e.date, [...(days.get(e.date) ?? []), b]);
  }
  const keys = [...days.keys()].sort();
  if (!keys.length) return [];
  const sessions = keys.map((k) => days.get(k)!);
  const flat = sessions.flat();

  const make = (si: number, prevClose: number): Gap | null => {
    const first = sessions[si][0];
    const open = first.open;
    if (!(prevClose > 0)) return null;
    const pct = ((open - prevClose) / prevClose) * 100;
    if (Math.abs(pct) < opts.minPct) return null;
    const up = open > prevClose;
    const startIdx = flat.indexOf(first);
    let extreme = open;
    let endTime: number | null = null;
    for (let i = startIdx; i < flat.length; i++) {
      const b = flat[i];
      extreme = up ? Math.min(extreme, b.low) : Math.max(extreme, b.high);
      if (up ? b.low <= prevClose : b.high >= prevClose) {
        endTime = b.time;
        break;
      }
    }
    const covered = up ? open - extreme : extreme - open;
    const fillPct = endTime !== null ? 100 : Math.max(0, Math.min(100, (covered / Math.abs(open - prevClose)) * 100));
    return { dir: up ? 'up' : 'down', prevClose, open, pct, startTime: first.time, endTime, filled: endTime !== null, fillPct };
  };

  const out: Gap[] = [];
  if (opts.prevCloseHint && sessions.length >= 1) {
    const g = make(0, opts.prevCloseHint);
    // the hint only applies when the data starts at the first session (nothing before it to compare with)
    if (g && sessions.length === 1) out.push(g);
  }
  for (let i = 1; i < sessions.length; i++) {
    const g = make(i, sessions[i - 1][sessions[i - 1].length - 1].close);
    if (g) out.push(g);
  }
  return out.slice(-40);
};
