import { ChartData } from '../types';

// Automatic chart analysis: swing points, support/resistance, trendlines, double tops/bottoms
// and the overall bullish/bearish structure. It reads whatever bars are on the chart, so the
// result changes with the timeframe and range, like drawing by hand on that chart would.

export interface Pivot {
  idx: number;
  price: number;
  type: 'high' | 'low';
  /** False for the latest swing, which is still in progress */
  confirmed: boolean;
}

export interface Level {
  price: number;
  kind: 'support' | 'resistance';
  touches: number;
  fromIdx: number;
}

export interface Trendline {
  kind: 'support' | 'resistance';
  a: { idx: number; price: number };
  b: { idx: number; price: number };
}

export type PatternType = 'double_top' | 'double_bottom';

export interface Pattern {
  type: PatternType;
  status: 'forming' | 'confirmed';
  /** The two peaks (or troughs) */
  first: Pivot;
  second: Pivot;
  /** The swing between them */
  middle: Pivot;
  neckline: number;
  /** Measured move target once the neckline breaks */
  target: number;
}

export type Bias = 'bullish' | 'bearish' | 'neutral';

export interface AutoChartResult {
  bias: Bias;
  headline: string;
  structure: string;
  pivots: Pivot[];
  levels: Level[];
  trendlines: Trendline[];
  pattern: Pattern | null;
  /** Zigzag sensitivity used (price units), for display */
  swingSize: number;
  bars: number;
}

export const MIN_AUTOCHART_BARS = 30;

const atr = (data: ChartData[], period = 14): number => {
  const n = data.length;
  const start = Math.max(1, n - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const prevClose = data[i - 1].close;
    sum += Math.max(data[i].high - data[i].low, Math.abs(data[i].high - prevClose), Math.abs(data[i].low - prevClose));
    count++;
  }
  return count ? sum / count : 0;
};

/** Zigzag swing points: a new swing needs a reversal of at least `dev` from the last extreme. */
export const findPivots = (data: ChartData[], dev: number): Pivot[] => {
  const pivots: Pivot[] = [];
  if (data.length < 2) return pivots;

  let dir = 0; // 1 = rising leg, -1 = falling leg
  let hi = { i: 0, p: data[0].high };
  let lo = { i: 0, p: data[0].low };

  for (let i = 1; i < data.length; i++) {
    const { high, low } = data[i];
    if (high > hi.p) hi = { i, p: high };
    if (low < lo.p) lo = { i, p: low };

    if (dir >= 0 && hi.p - low >= dev && hi.i !== i) {
      pivots.push({ idx: hi.i, price: hi.p, type: 'high', confirmed: true });
      dir = -1;
      lo = { i, p: low };
    } else if (dir <= 0 && high - lo.p >= dev && lo.i !== i) {
      pivots.push({ idx: lo.i, price: lo.p, type: 'low', confirmed: true });
      dir = 1;
      hi = { i, p: high };
    }
  }

  // the leg still in progress
  if (dir === -1) pivots.push({ idx: lo.i, price: lo.p, type: 'low', confirmed: false });
  else if (dir === 1) pivots.push({ idx: hi.i, price: hi.p, type: 'high', confirmed: false });
  return pivots;
};

const detectPattern = (data: ChartData[], pivots: Pivot[], dev: number): Pattern | null => {
  const n = data.length;
  const lastClose = data[n - 1].close;
  const minGap = Math.max(5, Math.round(n * 0.04));
  let best: Pattern | null = null;

  for (let k = 0; k + 2 < pivots.length; k++) {
    const [p1, mid, p2] = [pivots[k], pivots[k + 1], pivots[k + 2]];
    if (p1.type !== p2.type || mid.type === p1.type) continue;
    // the pattern must be recent: its second extreme is one of the last two swings
    if (k + 2 < pivots.length - 2) continue;
    if (p2.idx - p1.idx < minGap) continue;

    const isTop = p1.type === 'high';
    const depth = isTop ? Math.min(p1.price, p2.price) - mid.price : mid.price - Math.max(p1.price, p2.price);
    if (depth < dev * 1.5) continue;
    // the two extremes must sit at about the same level
    if (Math.abs(p1.price - p2.price) > depth * 0.35) continue;

    // invalidated if price has pushed well beyond the pattern since the second extreme
    let beyond = false;
    for (let i = p2.idx + 1; i < n; i++) {
      if (isTop ? data[i].high > Math.max(p1.price, p2.price) + dev * 0.75 : data[i].low < Math.min(p1.price, p2.price) - dev * 0.75) {
        beyond = true;
        break;
      }
    }
    if (beyond) continue;

    const neckline = mid.price;
    const extreme = (p1.price + p2.price) / 2;
    const confirmed = isTop ? lastClose < neckline : lastClose > neckline;
    const candidate: Pattern = {
      type: isTop ? 'double_top' : 'double_bottom',
      status: confirmed ? 'confirmed' : 'forming',
      first: p1,
      second: p2,
      middle: mid,
      neckline,
      target: isTop ? neckline - (extreme - neckline) : neckline + (neckline - extreme),
    };
    // A pattern that has not broken yet only counts while price is still up near the second top
    // (or down near the second bottom); a mid-range price is just a range, not a pattern
    if (!confirmed) {
      const reached = isTop ? lastClose >= neckline + depth * 0.3 : lastClose <= neckline - depth * 0.3;
      if (!reached) continue;
    }
    if (!best || candidate.second.idx >= best.second.idx) best = candidate;
  }
  return best;
};

const clusterLevels = (pivots: Pivot[], lastClose: number, tolerance: number): Level[] => {
  const used = new Set<number>();
  const levels: Level[] = [];
  pivots.forEach((p, i) => {
    if (used.has(i)) return;
    const group = pivots.map((q, j) => ({ q, j })).filter(({ q, j }) => !used.has(j) && Math.abs(q.price - p.price) <= tolerance);
    if (group.length < 2) return;
    group.forEach(({ j }) => used.add(j));
    const price = group.reduce((s, { q }) => s + q.price, 0) / group.length;
    levels.push({
      price,
      kind: price >= lastClose ? 'resistance' : 'support',
      touches: group.length,
      fromIdx: Math.min(...group.map(({ q }) => q.idx)),
    });
  });
  // keep the two nearest above and below the current price
  const above = levels.filter((l) => l.price >= lastClose).sort((a, b) => a.price - b.price).slice(0, 2);
  const below = levels.filter((l) => l.price < lastClose).sort((a, b) => b.price - a.price).slice(0, 2);
  return [...above, ...below];
};

const describeStructure = (pivots: Pivot[]): { bias: Bias; text: string } => {
  const highs = pivots.filter((p) => p.type === 'high');
  const lows = pivots.filter((p) => p.type === 'low');
  if (highs.length < 2 || lows.length < 2) return { bias: 'neutral', text: 'Not enough swings yet to read the structure' };

  const [h0, h1] = [highs[highs.length - 2], highs[highs.length - 1]];
  const [l0, l1] = [lows[lows.length - 2], lows[lows.length - 1]];
  const higherHigh = h1.price > h0.price;
  const higherLow = l1.price > l0.price;

  if (higherHigh && higherLow) return { bias: 'bullish', text: 'Higher highs and higher lows (uptrend)' };
  if (!higherHigh && !higherLow) return { bias: 'bearish', text: 'Lower highs and lower lows (downtrend)' };
  if (higherHigh && !higherLow) return { bias: 'neutral', text: 'Higher highs but lower lows (widening range)' };
  return { bias: 'neutral', text: 'Lower highs but higher lows (narrowing range)' };
};

const buildTrendlines = (pivots: Pivot[]): Trendline[] => {
  const lines: Trendline[] = [];
  const highs = pivots.filter((p) => p.type === 'high');
  const lows = pivots.filter((p) => p.type === 'low');
  if (highs.length >= 2) {
    const [a, b] = [highs[highs.length - 2], highs[highs.length - 1]];
    lines.push({ kind: 'resistance', a: { idx: a.idx, price: a.price }, b: { idx: b.idx, price: b.price } });
  }
  if (lows.length >= 2) {
    const [a, b] = [lows[lows.length - 2], lows[lows.length - 1]];
    lines.push({ kind: 'support', a: { idx: a.idx, price: a.price }, b: { idx: b.idx, price: b.price } });
  }
  return lines;
};

export const analyzeChart = (data: ChartData[]): AutoChartResult | null => {
  if (data.length < MIN_AUTOCHART_BARS) return null;

  const lastClose = data[data.length - 1].close;
  const dev = Math.max(atr(data) * 2.5, lastClose * 0.003);
  const pivots = findPivots(data, dev);
  const structure = describeStructure(pivots);
  const pattern = detectPattern(data, pivots, dev);

  let bias = structure.bias;
  let headline = bias === 'bullish' ? 'Bullish structure' : bias === 'bearish' ? 'Bearish structure' : 'Neutral / range-bound';

  if (pattern) {
    const top = pattern.type === 'double_top';
    const name = top ? 'Double top' : 'Double bottom';
    if (pattern.status === 'confirmed') {
      bias = top ? 'bearish' : 'bullish';
      headline = `${name} confirmed: ${top ? 'bearish' : 'bullish'} reversal`;
    } else {
      headline = `${name} forming (${top ? 'bearish' : 'bullish'} if the neckline breaks)`;
    }
  }

  return {
    bias,
    headline,
    structure: structure.text,
    pivots,
    levels: clusterLevels(pivots, lastClose, dev * 0.6),
    trendlines: buildTrendlines(pivots),
    pattern,
    swingSize: dev,
    bars: data.length,
  };
};
