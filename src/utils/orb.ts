import { ChartData } from '../types';
import { etClock } from './lateDay';

/**
 * Opening-range breakout (ORB), a classic rule-based day-trade used here for paper trading and backtests.
 * Rules: the first `orMinutes` of the regular session set a high and a low. The first bar that closes above the
 * high (long) or below the low (short), before `lastEntryMin`, is the signal. The trade enters at the next bar's
 * open with the stop at the other side of the range and a target `targetR` times the risk away. Anything still
 * open at the close is sold. One trade per day.
 */
export interface OrbParams {
  orMinutes: number;
  targetR: number;
  /** Percent of equity risked per trade */
  riskPct: number;
  /** Dollars per share lost to slippage on each side */
  slippage: number;
  startEquity: number;
  /** No new entries after this many minutes since midnight New York time (900 = 3:00 pm) */
  lastEntryMin: number;
  longs: boolean;
  shorts: boolean;
}

export const DEFAULT_ORB: OrbParams = {
  orMinutes: 15,
  targetR: 2,
  riskPct: 1,
  slippage: 0.01,
  startEquity: 100_000,
  lastEntryMin: 15 * 60,
  longs: true,
  shorts: true,
};

export interface OrbTrade {
  date: string;
  side: 'long' | 'short';
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exit: number;
  reason: 'target' | 'stop' | 'close';
  qty: number;
  pnl: number;
  /** Result in multiples of the risk taken */
  r: number;
}

export interface OrbStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancyR: number;
  totalPnl: number;
  returnPct: number;
  maxDrawdownPct: number;
  days: number;
}

export interface OrbResult {
  trades: OrbTrade[];
  equity: { time: number; value: number }[];
  stats: OrbStats;
}

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const r2 = (x: number) => Math.round(x * 100) / 100;

const regularByDay = (bars: ChartData[]): Map<string, ChartData[]> => {
  const out = new Map<string, ChartData[]>();
  for (const b of [...bars].sort((a, c) => a.time - c.time)) {
    const e = etClock(b.time);
    if (e.minutes < OPEN || e.minutes >= CLOSE) continue;
    out.set(e.date, [...(out.get(e.date) ?? []), b]);
  }
  return out;
};

interface Setup {
  side: 'long' | 'short';
  /** index of the bar whose close broke the range */
  signalIdx: number;
  orHigh: number;
  orLow: number;
}

/** The first valid breakout of the opening range in one day's bars, or null */
const findSetup = (day: ChartData[], p: OrbParams): Setup | null => {
  if (day.length < 6) return null;
  const barMin = Math.max(1, Math.round((day[1].time - day[0].time) / 60_000));
  const inOr = day.filter((b) => etClock(b.time).minutes < OPEN + p.orMinutes);
  if (inOr.length < Math.max(1, Math.floor((p.orMinutes / barMin) * 0.8))) return null;
  const orHigh = Math.max(...inOr.map((b) => b.high));
  const orLow = Math.min(...inOr.map((b) => b.low));
  const widthPct = ((orHigh - orLow) / orLow) * 100;
  if (widthPct < 0.1 || widthPct > 4) return null; // noise, or too wide to risk sensibly
  for (let i = inOr.length; i < day.length; i++) {
    if (etClock(day[i].time).minutes >= p.lastEntryMin) break;
    if (p.longs && day[i].close > orHigh) return { side: 'long', signalIdx: i, orHigh, orLow };
    if (p.shorts && day[i].close < orLow) return { side: 'short', signalIdx: i, orHigh, orLow };
  }
  return null;
};

export const runOrb = (bars: ChartData[], params: Partial<OrbParams> = {}): OrbResult => {
  const p = { ...DEFAULT_ORB, ...params };
  let equity = p.startEquity;
  const trades: OrbTrade[] = [];
  const curve: { time: number; value: number }[] = [];
  const days = regularByDay(bars);

  for (const [date, day] of days) {
    const setup = findSetup(day, p);
    if (!setup || setup.signalIdx + 1 >= day.length) continue;
    const long = setup.side === 'long';
    const dir = long ? 1 : -1;
    const entryBar = day[setup.signalIdx + 1];
    const entry = entryBar.open + dir * p.slippage;
    const stop = long ? setup.orLow : setup.orHigh;
    const risk = Math.abs(entry - stop);
    if (risk <= 0 || (long && stop >= entry) || (!long && stop <= entry)) continue;
    const target = entry + dir * risk * p.targetR;
    const qty = Math.floor(Math.min((equity * p.riskPct) / 100 / risk, equity / entry));
    if (qty < 1) continue;

    let exit = day[day.length - 1].close;
    let exitTime = day[day.length - 1].time;
    let reason: OrbTrade['reason'] = 'close';
    for (let j = setup.signalIdx + 1; j < day.length; j++) {
      const b = day[j];
      const hitStop = long ? b.low <= stop : b.high >= stop;
      const hitTarget = long ? b.high >= target : b.low <= target;
      if (hitStop) {
        // a gap through the stop fills at the open; when stop and target are both inside one bar, assume the stop came first
        exit = long ? Math.min(b.open, stop) : Math.max(b.open, stop);
        exitTime = b.time;
        reason = 'stop';
        break;
      }
      if (hitTarget) {
        exit = long ? Math.max(b.open, target) : Math.min(b.open, target);
        exitTime = b.time;
        reason = 'target';
        break;
      }
    }
    exit -= dir * p.slippage;
    const pnl = (exit - entry) * dir * qty;
    equity += pnl;
    trades.push({ date, side: setup.side, entryTime: entryBar.time, entry: r2(entry), stop: r2(stop), target: r2(target), exitTime, exit: r2(exit), reason, qty, pnl: r2(pnl), r: (exit - entry) * dir / risk });
    curve.push({ time: exitTime, value: equity });
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let peak = p.startEquity, maxDd = 0;
  for (const c of curve) {
    peak = Math.max(peak, c.value);
    maxDd = Math.max(maxDd, (peak - c.value) / peak);
  }
  return {
    trades,
    equity: [{ time: curve[0]?.time ?? 0, value: p.startEquity }, ...curve],
    stats: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? wins.length / trades.length : 0,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? -grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
      expectancyR: trades.length ? trades.reduce((s, t) => s + t.r, 0) / trades.length : 0,
      totalPnl: equity - p.startEquity,
      returnPct: ((equity - p.startEquity) / p.startEquity) * 100,
      maxDrawdownPct: maxDd * 100,
      days: days.size,
    },
  };
};

export interface OrbSignal {
  side: 'long' | 'short';
  date: string;
  /** Price of the bar that broke the range (the live entry is about here) */
  price: number;
  stop: number;
  target: number;
  orHigh: number;
  orLow: number;
  time: number;
}

/** Today's breakout from live bars, or null. Used to alert and to place the paper trade. */
export const orbSignal = (bars: ChartData[], params: Partial<OrbParams> = {}): OrbSignal | null => {
  const p = { ...DEFAULT_ORB, ...params };
  const days = regularByDay(bars);
  const keys = [...days.keys()].sort();
  if (!keys.length) return null;
  const date = keys[keys.length - 1];
  const day = days.get(date)!;
  const s = findSetup(day, p);
  if (!s) return null;
  const long = s.side === 'long';
  const price = day[s.signalIdx].close;
  const stop = long ? s.orLow : s.orHigh;
  const risk = Math.abs(price - stop);
  if (risk <= 0) return null;
  return { side: s.side, date, price, stop, target: price + (long ? 1 : -1) * risk * p.targetR, orHigh: s.orHigh, orLow: s.orLow, time: day[s.signalIdx].time };
};
