import { ChartData } from '../types';
import { findAirGap, findCurl } from './airGap';
import { etClock } from './lateDay';

export type BtSignal = 'airgap' | 'curl';

export interface BtParams {
  signal: BtSignal;
  /** Air gap: smallest room to the next cloud, in ATRs */
  minRoomAtr: number;
  /** Air gap: stop at the opposite cloud edge, or this many ATRs from the entry (0 = cloud edge) */
  stopAtr: number;
  /** Air gap: target at the next cloud (0) or this many ATRs; curl: always uses these two (defaults 1 / 1.5) */
  targetAtr: number;
  side: 'both' | 'long' | 'short';
  /** Only trades where the fast cloud agrees with the direction */
  withTrendOnly: boolean;
  /** Round-trip cost (commission + slippage) as a percent of the price */
  costPct: number;
}

export const DEFAULT_BT: BtParams = { signal: 'airgap', minRoomAtr: 1.5, stopAtr: 0, targetAtr: 0, side: 'both', withTrendOnly: false, costPct: 0.05 };

export interface BtTrade {
  symbol: string;
  time: number;
  side: 'long' | 'short';
  out: 'target' | 'stop' | 'eod';
  /** Gross result in ATRs and net result in percent of the entry price (after costs) */
  pnlAtr: number;
  pnlPct: number;
  /** The same geometry on the opposite side of the entry: if this does as well, the signal adds nothing */
  mirrorPnlAtr: number;
  mirrorPct: number;
}

const sim = (bars: ChartData[], i: number, day: string, side: 'long' | 'short', stop: number, target: number) => {
  let j = i + 1;
  for (; j < bars.length && etClock(bars[j].time).date === day; j++) {
    const b = bars[j];
    // stop first when one candle touches both
    if (side === 'long' ? b.low <= stop : b.high >= stop) return { out: 'stop' as const, px: stop };
    if (side === 'long' ? b.high >= target : b.low <= target) return { out: 'target' as const, px: target };
  }
  return { out: 'eod' as const, px: bars[Math.max(i, j - 1)].close };
};

/** Walk forward through one symbol's candles, taking every signal the app would have shown, and return the trades. */
export const backtestSymbol = (symbol: string, bars: ChartData[], p: BtParams): BtTrade[] => {
  const out: BtTrade[] = [];
  if (bars.length < 260) return out;
  const days = [...new Set(bars.map((b) => etClock(b.time).date))];
  const range: Record<string, [number, number]> = {};
  for (const b of bars) {
    const d = etClock(b.time).date;
    const r = range[d];
    range[d] = r ? [Math.max(r[0], b.high), Math.min(r[1], b.low)] : [b.high, b.low];
  }
  const dayIdx = new Map(days.map((d, k) => [d, k]));
  let lastCurl = -99;
  for (let i = 220; i < bars.length - 1; i++) {
    const c = etClock(bars[i].time);
    if (c.minutes < 9 * 60 + 45 || c.minutes > 15 * 60 + 15) continue;
    const di = dayIdx.get(c.date)!;
    if (di < 15) continue;
    const win = bars.slice(Math.max(0, i - 300), i + 1);
    let side: 'long' | 'short', stop: number, target: number, atr: number, aligned = true;
    const entry = bars[i].close;
    if (p.signal === 'airgap') {
      const prior = days.slice(di - 14, di).map((d) => range[d][0] - range[d][1]);
      const s = findAirGap(symbol, win, prior.reduce((a, x) => a + x, 0) / prior.length);
      if (!s || s.state !== 'entry' || s.breakTime !== bars[i].time || s.roomAtr < p.minRoomAtr) continue;
      side = s.side; atr = s.atr; aligned = s.aligned;
      stop = p.stopAtr > 0 ? (side === 'long' ? entry - p.stopAtr * atr : entry + p.stopAtr * atr) : s.stop;
      target = p.targetAtr > 0 ? (side === 'long' ? entry + p.targetAtr * atr : entry - p.targetAtr * atr) : s.target;
    } else {
      const cu = findCurl(symbol, win);
      if (!cu || i - lastCurl <= 6) { if (cu) lastCurl = i; continue; }
      lastCurl = i;
      side = cu.side === 'up' ? 'long' : 'short';
      atr = win.slice(-14).reduce((a, b) => a + (b.high - b.low), 0) / 14;
      const sd = (p.stopAtr || 1) * atr, td = (p.targetAtr || 1.5) * atr;
      stop = side === 'long' ? entry - sd : entry + sd;
      target = side === 'long' ? entry + td : entry - td;
    }
    if (p.side !== 'both' && side !== p.side) continue;
    if (p.withTrendOnly && !aligned) continue;
    if (!(Math.abs(entry - stop) > 0) || !(atr > 0)) continue;
    const ms = side === 'long' ? 'short' : 'long';
    const mStop = ms === 'long' ? entry - Math.abs(entry - stop) : entry + Math.abs(entry - stop);
    const mTgt = ms === 'long' ? entry + Math.abs(target - entry) : entry - Math.abs(target - entry);
    const r = sim(bars, i, c.date, side, stop, target);
    const m = sim(bars, i, c.date, ms, mStop, mTgt);
    const mv = (s: 'long' | 'short', px: number) => (s === 'long' ? px - entry : entry - px);
    out.push({
      symbol, time: bars[i].time, side, out: r.out,
      pnlAtr: mv(side, r.px) / atr, pnlPct: (mv(side, r.px) / entry) * 100 - p.costPct,
      mirrorPnlAtr: mv(ms, m.px) / atr, mirrorPct: (mv(ms, m.px) / entry) * 100 - p.costPct,
    });
  }
  return out;
};

export interface BtStats {
  n: number; targetPct: number; stopPct: number; eodPct: number; winPct: number;
  avgAtr: number; avgPct: number; totalPct: number; profitFactor: number; maxDdPct: number; mirrorAvgPct: number; mirrorAvgAtr: number;
}
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export const btStats = (t: BtTrade[]): BtStats => {
  const n = t.length;
  const g = t.filter((x) => x.pnlPct > 0).reduce((s, x) => s + x.pnlPct, 0);
  const l = -t.filter((x) => x.pnlPct < 0).reduce((s, x) => s + x.pnlPct, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const x of [...t].sort((a, b) => a.time - b.time)) { eq += x.pnlPct; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const pc = (k: BtTrade['out']) => (n ? (t.filter((x) => x.out === k).length / n) * 100 : 0);
  return {
    n, targetPct: pc('target'), stopPct: pc('stop'), eodPct: pc('eod'), winPct: n ? (t.filter((x) => x.pnlPct > 0).length / n) * 100 : 0,
    avgAtr: mean(t.map((x) => x.pnlAtr)), avgPct: mean(t.map((x) => x.pnlPct)), totalPct: t.reduce((s, x) => s + x.pnlPct, 0),
    profitFactor: l > 0 ? g / l : g > 0 ? Infinity : 0, maxDdPct: dd, mirrorAvgPct: mean(t.map((x) => x.mirrorPct)), mirrorAvgAtr: mean(t.map((x) => x.mirrorPnlAtr)),
  };
};
