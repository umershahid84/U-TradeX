import { ChartData } from '../types';
import { calculateRSISeries } from './indicators';
import { findPivots } from './autoChart';
import { calculateEMAFromFirst } from './indicators';

// "Alpha Signals": an original trend-and-stage indicator. A thick colour-changing trend line, a
// thin slow line, stage labels (EARLY, ENTRY, CAUTION, TAKE PROFIT, EXIT) and a dashboard with
// trend, action, confidence, risk, an entry zone and nearby support/resistance. The rules below
// are this app's own; they are not taken from any commercial indicator.

export type AlphaStage = 'EARLY' | 'ENTRY' | 'CAUTION' | 'TAKE PROFIT' | 'EXIT';
export type AlphaSide = 'long' | 'short';

export interface AlphaOptions {
  enabled: boolean;
  fast: number;
  slow: number;
  labels: boolean;
  dashboard: boolean;
}

export const DEFAULT_ALPHA: AlphaOptions = { enabled: false, fast: 9, slow: 34, labels: true, dashboard: true };

export interface AlphaLabel {
  idx: number;
  stage: AlphaStage;
  side: AlphaSide;
}

export type LineState = 'bull' | 'caution' | 'profit' | 'bear' | 'neutral';

export interface AlphaDashboard {
  trend: string;
  trendState: LineState;
  action: string;
  confidence: number;
  risk: 'Low' | 'Medium' | 'High';
  entryLow: number;
  entryHigh: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export interface AlphaResult {
  fast: number[];
  slow: number[];
  /** Colour state of the thick line on each bar */
  state: LineState[];
  labels: AlphaLabel[];
  dashboard: AlphaDashboard;
}

export const MIN_ALPHA_BARS = 60;

const sma = (a: number[], i: number, n: number) => {
  let s = 0, c = 0;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) { s += a[j]; c++; }
  return c ? s / c : 0;
};

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export const analyzeAlpha = (data: ChartData[], opts: Pick<AlphaOptions, 'fast' | 'slow'> = DEFAULT_ALPHA): AlphaResult | null => {
  const n = data.length;
  if (n < MIN_ALPHA_BARS) return null;

  const hl2 = data.map((d) => (d.high + d.low) / 2);
  const fast = calculateEMAFromFirst(hl2, opts.fast);
  const slow = calculateEMAFromFirst(hl2, opts.slow);
  const rsi = calculateRSISeries(data.map((d) => d.close), 14);
  const vol = data.map((d) => d.volume);

  // Wilder ATR
  const tr = data.map((d, i) => (i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - data[i - 1].close), Math.abs(d.low - data[i - 1].close))));
  const atr: number[] = [];
  tr.forEach((t, i) => atr.push(i === 0 ? t : (atr[i - 1] * 13 + t) / 14));

  let pos: 0 | 1 | -1 = 0; // trade the engine considers open
  let cooldownProfit = -99;
  let tradeStart = -99; // bar where the current trade was entered
  let lastExit = -99;
  const warmup = Math.max(opts.slow, 20); // the averages are not meaningful before this
  const labels: AlphaLabel[] = [];
  const state: LineState[] = [];
  const lastLabel: Record<string, number> = {};
  const add = (idx: number, stage: AlphaStage, side: AlphaSide, gap = 4) => {
    const key = `${stage}${side}`;
    if (idx - (lastLabel[key] ?? -99) < gap) return;
    lastLabel[key] = idx;
    labels.push({ idx, stage, side });
  };
  let caution = false;
  let profit = false;

  for (let i = 1; i < n; i++) {
    const c = data[i].close, o = data[i].open;
    const live = i >= warmup;
    const a = Math.max(atr[i], 1e-9);
    const slope = (fast[i] - fast[Math.max(0, i - 3)]) / a;
    const bodyUp = c > o;
    const range = data[i].high - data[i].low;
    const upperWick = (data[i].high - Math.max(c, o)) / Math.max(range, 1e-9);
    const lowerWick = (Math.min(c, o) - data[i].low) / Math.max(range, 1e-9);
    const ext = (c - fast[i]) / a; // distance from the fast line in ATRs
    const r = Number.isFinite(rsi[i]) ? rsi[i] : 50;
    const prevAbove = data[i - 1].close > fast[i - 1];
    const crossUp = c > fast[i] && !prevAbove;
    const crossDown = c < fast[i] && prevAbove;

    // --- exits first: a close through the slow line ends the trade
    const held = i - tradeStart;
    if (live && pos === 1 && held >= 3 && c < slow[i] - 0.1 * a) { add(i, 'EXIT', 'long', 3); pos = 0; lastExit = i; caution = false; profit = false; }
    else if (live && pos === -1 && held >= 3 && c > slow[i] + 0.1 * a) { add(i, 'EXIT', 'short', 3); pos = 0; lastExit = i; caution = false; profit = false; }

    // --- early reversal: first push back through the fast line against the slow trend
    if (live && pos === 0) {
      if (crossUp && fast[i] <= slow[i] && (bodyUp || lowerWick > 0.4) && r < 58) add(i, 'EARLY', 'long', 6);
      if (crossDown && fast[i] >= slow[i] && (!bodyUp || upperWick > 0.4) && r > 42) add(i, 'EARLY', 'short', 6);
    }

    // --- entry: price and fast line agree with the slow line, not too far from it, and not right after an exit
    if (live && pos === 0 && i - lastExit >= 8) {
      if (c > fast[i] && c > slow[i] && slope > 0.18 && fast[i] > slow[i] && ext < 1.6 && bodyUp) { add(i, 'ENTRY', 'long', 8); pos = 1; tradeStart = i; caution = false; profit = false; }
      else if (c < fast[i] && c < slow[i] && slope < -0.18 && fast[i] < slow[i] && ext > -1.6 && !bodyUp) { add(i, 'ENTRY', 'short', 8); pos = -1; tradeStart = i; caution = false; profit = false; }
    }

    // --- managing an open trade
    if (live && pos === 1) {
      if (ext > 2.2 || r > 76) { if (i - cooldownProfit > 8) { add(i, 'TAKE PROFIT', 'long', 8); cooldownProfit = i; } profit = true; caution = false; }
      else if (i - tradeStart >= 4 && (crossDown || (upperWick > 0.6 && !bodyUp && ext > 0.8))) { add(i, 'CAUTION', 'long', 12); caution = true; profit = false; }
      else if (c > fast[i] && ext < 1.5) { caution = false; profit = false; }
    } else if (live && pos === -1) {
      if (ext < -2.2 || r < 24) { if (i - cooldownProfit > 8) { add(i, 'TAKE PROFIT', 'short', 8); cooldownProfit = i; } profit = true; caution = false; }
      else if (i - tradeStart >= 4 && (crossUp || (lowerWick > 0.6 && bodyUp && ext < -0.8))) { add(i, 'CAUTION', 'short', 12); caution = true; profit = false; }
      else if (c < fast[i] && ext > -1.5) { caution = false; profit = false; }
    }

    // --- colour of the thick line
    state.push(
      profit ? 'profit' : caution ? 'caution'
      : fast[i] > slow[i] && slope >= -0.05 ? 'bull'
      : fast[i] < slow[i] && slope <= 0.05 ? 'bear' : 'neutral'
    );
  }
  state.unshift(state[0] ?? 'neutral');

  // ---------- dashboard for the latest bar ----------
  const last = n - 1;
  const c = data[last].close;
  const a = Math.max(atr[last], 1e-9);
  const dirLong = pos === 1 || (pos === 0 && fast[last] >= slow[last]);
  const dir = dirLong ? 1 : -1;
  const ext = (c - fast[last]) / a;
  const r = Number.isFinite(rsi[last]) ? rsi[last] : 50;
  const slope = (fast[last] - fast[Math.max(0, last - 3)]) / a;
  const volRatio = vol[last] > 0 ? vol[last] / Math.max(sma(vol, last, 20), 1e-9) : 1;

  const align = (fast[last] > slow[last] ? 1 : -1) === dir ? 1 : 0;
  const momentum = clamp(((r - 50) * dir) / 25 + 0.5);
  const slopeScore = clamp((slope * dir) / 0.5);
  const volScore = clamp(volRatio / 1.5);
  const roomScore = 1 - clamp(Math.abs(ext) / 3);
  const confidence = Math.round(clamp((30 * align + 20 * momentum + 20 * slopeScore + 15 * volScore + 15 * roomScore) / 100, 0.05, 0.95) * 100);

  const atrPct = atr.slice(-50).map((x, j) => x / Math.max(data[n - 50 + j]?.close ?? c, 1e-9));
  const medianAtr = [...atrPct].sort((x, y) => x - y)[Math.floor(atrPct.length / 2)] || 0;
  const nowAtr = a / c;
  const risk: AlphaDashboard['risk'] = Math.abs(ext) > 2 || nowAtr > medianAtr * 1.6 ? 'High' : Math.abs(ext) > 1 || nowAtr > medianAtr * 1.2 ? 'Medium' : 'Low';

  const latest = [...labels].reverse().find((l) => l.idx >= last - 6);
  let trend = dirLong ? 'BULLISH' : 'BEARISH';
  let action = pos === 0 ? 'WAIT' : 'HOLD';
  let trendState: LineState = state[last];
  if (latest) {
    switch (latest.stage) {
      case 'EARLY': trend = 'EARLY REVERSAL'; action = 'WATCH'; break;
      case 'ENTRY': trend = latest.side === 'long' ? 'BULLISH' : 'BEARISH'; action = latest.side === 'long' ? 'ENTER LONG' : 'ENTER SHORT'; break;
      case 'CAUTION': trend = 'CAUTION'; action = 'TIGHTEN STOP'; trendState = 'caution'; break;
      case 'TAKE PROFIT': trend = 'TAKE PROFIT'; action = 'LOCK PROFIT'; trendState = 'profit'; break;
      case 'EXIT': trend = 'EXIT'; action = 'CLOSE POSITION'; trendState = 'bear'; break;
    }
  } else if (pos === 0 && Math.abs(fast[last] - slow[last]) < a * 0.3) {
    trend = 'NEUTRAL';
    trendState = 'neutral';
  }

  // support / resistance: nearest swing points, else ATR steps
  const swings = findPivots(data, Math.max(a * 2.5, c * 0.003));
  const above = swings.filter((p) => p.type === 'high' && p.price > c).map((p) => p.price).sort((x, y) => x - y);
  const below = swings.filter((p) => p.type === 'low' && p.price < c).map((p) => p.price).sort((x, y) => y - x);
  const r1 = above[0] ?? c + 1.5 * a;
  const r2 = above[1] ?? Math.max(r1 + a, c + 2.5 * a);
  const s1 = below[0] ?? c - 1.5 * a;
  const s2 = below[1] ?? Math.min(s1 - a, c - 2.5 * a);

  return {
    fast,
    slow,
    state,
    labels,
    dashboard: {
      trend, trendState, action, confidence, risk,
      entryLow: fast[last] - 0.3 * a, entryHigh: fast[last] + 0.3 * a,
      r1, r2, s1, s2,
    },
  };
};
