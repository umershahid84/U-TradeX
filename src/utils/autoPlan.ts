import { ChartData } from '../types';
import { chartIntervalMs, movingAverage, sourceValue } from './htfEma';
import { etClock } from './lateDay';

/**
 * Automatic trade plan from EMA clouds. The 5/12 cloud (EMA 5 and 12 of the high-low midpoint) is the trigger: a
 * candle that closes through the whole cloud is the entry. The stop is a close back through the cloud plus a small
 * buffer. Targets are the nearest price levels in the trade's direction (the 34/50 cloud, VWAP and the day's
 * highs and lows), with a "cheat" exit just in front of target 1. Seven checks rate the setup. This is a rule-based
 * reading of the chart, not a prediction or advice.
 */
export type PlanSide = 'long' | 'short';
export type PlanPhase = 'watching' | 'entry' | 'in_trade' | 'target1' | 'target2' | 'stopped';

export interface PlanOptions {
  fast: [number, number];
  slow: [number, number];
  /** Stop buffer beyond the cloud, as a fraction of the 14-bar average true range */
  bufferAtr: number;
  /** Least dollars between the entry and target 1 */
  minRoom: number;
  /** Least reward to risk to target 1 */
  minRR: number;
  now?: number;
}

export const DEFAULT_PLAN_OPTS: PlanOptions = { fast: [5, 12], slow: [34, 50], bufferAtr: 0.1, minRoom: 1.5, minRR: 1.5 };

export interface PlanLevel {
  label: string;
  price: number;
  kind: 'cloud' | 'day' | 'vwap';
}

export interface PlanCheck {
  id: string;
  label: string;
  ok: boolean;
  value: string;
}

export interface AirGap {
  from: number;
  to: number;
  amount: number;
}

export interface AutoPlan {
  side: PlanSide;
  phase: PlanPhase;
  /** A candle has already closed through the cloud (otherwise the levels are what the plan would be) */
  triggered: boolean;
  entry: number;
  stop: number;
  cheat: number;
  t1: number;
  t2: number;
  /** Dollars between entry and stop / target 1, and the reward to risk */
  risk: number;
  room: number;
  rr: number;
  price: number;
  breakTime: number | null;
  breakIdx: number | null;
  fastCloud: { top: number; bottom: number };
  slowCloud: { top: number; bottom: number };
  levels: PlanLevel[];
  airGap: AirGap | null;
  checks: PlanCheck[];
  checkCount: number;
  message: string;
  barMs: number;
}

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const r2 = (x: number) => Math.round(x * 100) / 100;

const atr14 = (bars: ChartData[]): number => {
  const n = bars.length;
  if (n < 2) return 0;
  const tr = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
  const last = tr.slice(-14);
  return last.reduce((s, x) => s + x, 0) / last.length;
};

export const buildPlan = (bars: ChartData[], opts: Partial<PlanOptions> = {}): AutoPlan | null => {
  const o = { ...DEFAULT_PLAN_OPTS, ...opts };
  if (bars.length < 60) return null;
  const now = o.now ?? Date.now();
  const n = bars.length;
  const barMs = chartIntervalMs(bars);
  if (!barMs) return null;

  const hl2 = bars.map((b) => sourceValue(b, 'hl2'));
  const e1 = movingAverage(hl2, o.fast[0], 'EMA');
  const e2 = movingAverage(hl2, o.fast[1], 'EMA');
  const e3 = movingAverage(hl2, o.slow[0], 'EMA');
  const e4 = movingAverage(hl2, o.slow[1], 'EMA');
  const fastTop = bars.map((_, i) => Math.max(e1[i], e2[i]));
  const fastBot = bars.map((_, i) => Math.min(e1[i], e2[i]));
  const slowTop = bars.map((_, i) => Math.max(e3[i], e4[i]));
  const slowBot = bars.map((_, i) => Math.min(e3[i], e4[i]));
  const side0 = (i: number): 'above' | 'below' | 'inside' => (bars[i].close > fastTop[i] ? 'above' : bars[i].close < fastBot[i] ? 'below' : 'inside');

  const lastClosed = bars.reduce((acc, b, i) => (b.time + barMs <= now ? i : acc), -1);
  const lastDate = etClock(bars[n - 1].time).date;
  const minutesOf = (i: number) => etClock(bars[i].time).minutes;
  const isRegular = (i: number) => minutesOf(i) >= OPEN && minutesOf(i) < CLOSE;
  const todayIdx: number[] = [];
  for (let i = 0; i < n; i++) if (etClock(bars[i].time).date === lastDate && isRegular(i)) todayIdx.push(i);
  if (!todayIdx.length) return null;

  // session levels as of bar i
  const dates = [...new Set(bars.filter((_, i) => isRegular(i)).map((b) => etClock(b.time).date))];
  const prevDate = dates.filter((d) => d < lastDate).pop();
  const prevIdx = bars.map((_, i) => i).filter((i) => isRegular(i) && etClock(bars[i].time).date === prevDate);
  const levelsAt = (i: number): PlanLevel[] => {
    const lv: PlanLevel[] = [];
    if (prevIdx.length) {
      lv.push({ label: 'PDH', price: Math.max(...prevIdx.map((k) => bars[k].high)), kind: 'day' });
      lv.push({ label: 'PDL', price: Math.min(...prevIdx.map((k) => bars[k].low)), kind: 'day' });
      lv.push({ label: 'PDC', price: bars[prevIdx[prevIdx.length - 1]].close, kind: 'day' });
    }
    const upto = todayIdx.filter((k) => k <= i);
    if (upto.length) {
      lv.push({ label: 'Open', price: bars[upto[0]].open, kind: 'day' });
      lv.push({ label: 'HOD', price: Math.max(...upto.map((k) => bars[k].high)), kind: 'day' });
      lv.push({ label: 'LOD', price: Math.min(...upto.map((k) => bars[k].low)), kind: 'day' });
      let pv = 0, vol = 0;
      for (const k of upto) {
        pv += ((bars[k].high + bars[k].low + bars[k].close) / 3) * bars[k].volume;
        vol += bars[k].volume;
      }
      if (vol > 0) lv.push({ label: 'VWAP', price: pv / vol, kind: 'vwap' });
    }
    lv.push({ label: '34/50 top', price: slowTop[i], kind: 'cloud' });
    lv.push({ label: '34/50 bottom', price: slowBot[i], kind: 'cloud' });
    lv.push({ label: '5/12 top', price: fastTop[i], kind: 'cloud' });
    lv.push({ label: '5/12 bottom', price: fastBot[i], kind: 'cloud' });
    return lv;
  };

  // entry, stop and targets for a break at bar i (or the plan it would be, for a prospective entry)
  const levelsFor = (side: PlanSide, i: number, entry: number) => {
    const dir = side === 'long' ? 1 : -1;
    const range = atr14(bars.slice(0, i + 1));
    const buffer = Math.max(0.02, o.bufferAtr * range);
    // beyond the cloud by the buffer, but never closer than half an average candle range (a very narrow cloud would
    // otherwise give a stop a few cents away)
    const stop = side === 'long' ? Math.min(fastBot[i] - buffer, entry - 0.5 * range) : Math.max(fastTop[i] + buffer, entry + 0.5 * range);
    const risk = Math.abs(entry - stop);
    const beyond = levelsAt(i)
      .filter((l) => (l.price - entry) * dir >= 0.5 * risk)
      .sort((a, b) => (a.price - entry) * dir - (b.price - entry) * dir);
    const t1 = beyond.length ? beyond[0].price : entry + dir * 1.5 * risk;
    const next = beyond.find((l) => (l.price - t1) * dir >= 0.5 * risk);
    const t2 = next ? next.price : t1 + dir * 1.5 * risk;
    const cheat = t1 - dir * Math.max(0.05, 0.05 * Math.abs(t1 - entry));
    return { stop, risk, t1, t2, cheat };
  };

  // every close through the whole cloud today
  type Evt = { idx: number; side: PlanSide };
  const events: Evt[] = [];
  for (const i of todayIdx) {
    if (i < 1 || i > lastClosed) continue;
    const s = side0(i), p = side0(i - 1);
    if (s === 'above' && p !== 'above') events.push({ idx: i, side: 'long' });
    if (s === 'below' && p !== 'below') events.push({ idx: i, side: 'short' });
  }

  const price = bars[n - 1].close;
  const cloudsNow = { fast: { top: fastTop[n - 1], bottom: fastBot[n - 1] }, slow: { top: slowTop[n - 1], bottom: slowBot[n - 1] } };

  const simulate = (ev: Evt) => {
    const long = ev.side === 'long';
    const entry = bars[ev.idx].close;
    const lv = levelsFor(ev.side, ev.idx, entry);
    let phase: PlanPhase = ev.idx >= lastClosed ? 'entry' : 'in_trade';
    let t1Hit = false;
    for (let j = ev.idx + 1; j < n; j++) {
      const b = bars[j];
      if (long ? b.high >= lv.t2 : b.low <= lv.t2) { phase = 'target2'; break; }
      if (long ? b.high >= lv.t1 : b.low <= lv.t1) { t1Hit = true; phase = 'target1'; }
      if (j <= lastClosed && (long ? b.close < lv.stop : b.close > lv.stop)) { phase = t1Hit ? 'target1' : 'stopped'; break; }
    }
    return { entry, ...lv, phase };
  };

  // volume check helper: the bar vs the 20 bars before it
  const volRatio = (i: number): number => {
    const prev = bars.slice(Math.max(0, i - 20), i).map((b) => b.volume);
    const avg = prev.length ? prev.reduce((s, x) => s + x, 0) / prev.length : 0;
    return avg > 0 ? bars[i].volume / avg : 0;
  };
  const vwapNow = levelsAt(n - 1).find((l) => l.kind === 'vwap')?.price ?? null;

  const last = events[events.length - 1];
  const before = events.length > 1 ? events[events.length - 2] : null;
  let side: PlanSide;
  let sim: ReturnType<typeof simulate> | null = null;
  if (last) {
    const s = simulate(last);
    // a finished trade stays on screen for a few candles, then the plan goes back to watching for the next one
    if ((s.phase === 'stopped' || s.phase === 'target2') && n - 1 - last.idx > 6) sim = null;
    else sim = s;
  }
  let lv: ReturnType<typeof levelsFor>;
  let entry: number;
  let phase: PlanPhase;
  let breakIdx: number | null = null;
  let message: string;
  const tf = barMs % 60_000 === 0 ? `${barMs / 60_000}-minute` : 'candle';
  if (sim && last) {
    side = last.side;
    entry = sim.entry;
    lv = sim;
    phase = sim.phase;
    breakIdx = last.idx;
    message =
      phase === 'entry'
        ? `${tf} candle closed ${side === 'long' ? 'above' : 'below'} the 5/12 cloud: entry${before && before.side !== side ? ` (the earlier ${before.side} was stopped)` : ''}`
      : phase === 'in_trade' ? 'In the trade: the stop is a close back through the cloud'
      : phase === 'target1' ? 'Target 1 reached'
      : phase === 'target2' ? 'Target 2 reached'
      : 'Stopped: a candle closed back through the cloud';
  } else {
    // watching: the side follows how the fast cloud sits against the slow cloud
    side = (e1[n - 1] + e2[n - 1]) / 2 >= (e3[n - 1] + e4[n - 1]) / 2 ? 'long' : 'short';
    entry = side === 'long' ? fastTop[n - 1] : fastBot[n - 1];
    lv = levelsFor(side, n - 1, entry);
    phase = 'watching';
    const gone = side === 'long' ? side0(n - 1) === 'above' : side0(n - 1) === 'below';
    message = gone
      ? `Price is already ${side === 'long' ? 'above' : 'below'} the 5/12 cloud: waiting for a pullback into it and a new ${tf} close ${side === 'long' ? 'above' : 'below'}`
      : `Waiting for a ${tf} close ${side === 'long' ? 'above' : 'below'} the 5/12 cloud`;
  }
  const room = Math.abs(lv.t1 - entry);
  const rr = lv.risk > 0 ? room / lv.risk : 0;

  const refIdx = breakIdx ?? n - 1;
  const minutes = minutesOf(refIdx);
  const fmtTime = (i: number) => new Date(bars[i].time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const checks: PlanCheck[] = [
    {
      id: 'break',
      label: 'Close through the whole 5/12 cloud',
      ok: phase !== 'watching',
      value: phase !== 'watching' && breakIdx !== null ? `${side === 'long' ? 'above' : 'below'} at ${fmtTime(breakIdx)} ET` : 'waiting',
    },
    {
      id: 'stack',
      label: 'Clouds stacked with the trade',
      ok: side === 'long' ? e2[refIdx] > e3[refIdx] : e2[refIdx] < e3[refIdx],
      value: `12 EMA ${e2[refIdx] > e3[refIdx] ? 'above' : 'below'} 34 EMA`,
    },
    { id: 'room', label: `At least $${o.minRoom.toFixed(2)} of room to target 1`, ok: room >= o.minRoom, value: `$${room.toFixed(2)}` },
    { id: 'rr', label: `Reward to risk of ${o.minRR} or better`, ok: rr >= o.minRR, value: `${rr.toFixed(2)} R` },
    {
      id: 'volume',
      label: 'Volume at or above the recent average',
      ok: volRatio(refIdx) >= 1,
      value: volRatio(refIdx) > 0 ? `${volRatio(refIdx).toFixed(2)}× average` : 'no volume data',
    },
    {
      id: 'vwap',
      label: 'Price on the trade side of VWAP',
      ok: vwapNow !== null && (side === 'long' ? price >= vwapNow : price <= vwapNow),
      value: vwapNow === null ? 'no VWAP' : `${price >= vwapNow ? 'above' : 'below'} $${vwapNow.toFixed(2)}`,
    },
    {
      id: 'time',
      label: 'In the trading window (9:45 am to 3:30 pm ET)',
      ok: minutes >= 9 * 60 + 45 && minutes < 15 * 60 + 30,
      value: `${fmtTime(refIdx)} ET`,
    },
  ];

  // elevator: every level in price order, and the air gap between the two clouds
  const levels = levelsAt(n - 1).sort((a, b) => b.price - a.price);
  const fastMid = (cloudsNow.fast.top + cloudsNow.fast.bottom) / 2;
  const slowMid = (cloudsNow.slow.top + cloudsNow.slow.bottom) / 2;
  let airGap: AirGap | null = null;
  if (fastMid >= slowMid && cloudsNow.fast.bottom > cloudsNow.slow.top) airGap = { from: cloudsNow.slow.top, to: cloudsNow.fast.bottom, amount: cloudsNow.fast.bottom - cloudsNow.slow.top };
  else if (fastMid < slowMid && cloudsNow.fast.top < cloudsNow.slow.bottom) airGap = { from: cloudsNow.fast.top, to: cloudsNow.slow.bottom, amount: cloudsNow.slow.bottom - cloudsNow.fast.top };

  return {
    side,
    phase,
    triggered: phase !== 'watching',
    entry: r2(entry),
    stop: r2(lv.stop),
    cheat: r2(lv.cheat),
    t1: r2(lv.t1),
    t2: r2(lv.t2),
    risk: lv.risk,
    room,
    rr,
    price,
    breakTime: breakIdx !== null ? bars[breakIdx].time : null,
    breakIdx,
    fastCloud: cloudsNow.fast,
    slowCloud: cloudsNow.slow,
    levels,
    airGap,
    checks,
    checkCount: checks.filter((c) => c.ok).length,
    message,
    barMs,
  };
};
