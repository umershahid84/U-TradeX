import { ChartData } from '../types';
import { calculateEMAFromFirst } from './indicators';

export type CloudTf = 'chart' | '1m' | '2m' | '5m' | '10m' | '15m' | '30m' | '1h' | '1d' | '1wk';

export interface CloudTfOption {
  value: CloudTf;
  label: string;
  /** Bar length in ms (0 for 'chart') */
  ms: number;
  /** Yahoo interval and how much history to load so long EMAs have time to settle */
  interval?: string;
  range?: string;
  /** Yahoo has no such interval, so the fetched bars are merged into buckets of `ms` */
  aggregate?: boolean;
}

const MIN = 60_000;
export const CLOUD_TFS: CloudTfOption[] = [
  { value: 'chart', label: 'Chart timeframe', ms: 0 },
  { value: '1m', label: '1 min', ms: MIN, interval: '1m', range: '5d' },
  { value: '2m', label: '2 min', ms: 2 * MIN, interval: '2m', range: '5d' },
  { value: '5m', label: '5 min', ms: 5 * MIN, interval: '5m', range: '5d' },
  // Yahoo has no 10-minute candles: build them from 5-minute ones
  { value: '10m', label: '10 min', ms: 10 * MIN, interval: '5m', range: '5d', aggregate: true },
  { value: '15m', label: '15 min', ms: 15 * MIN, interval: '15m', range: '1mo' },
  { value: '30m', label: '30 min', ms: 30 * MIN, interval: '30m', range: '1mo' },
  { value: '1h', label: '1 hour', ms: 60 * MIN, interval: '1h', range: '3mo' },
  { value: '1d', label: 'Daily', ms: 24 * 60 * MIN, interval: '1d', range: '2y' },
  { value: '1wk', label: 'Weekly', ms: 7 * 24 * 60 * MIN, interval: '1wk', range: '5y' },
];

export const tfOption = (tf: CloudTf): CloudTfOption => CLOUD_TFS.find((o) => o.value === tf) ?? CLOUD_TFS[0];

/** Typical bar length of the chart, in ms */
export const chartIntervalMs = (data: { time: number }[]): number => {
  if (data.length < 2) return 0;
  const diffs = data.slice(1).map((d, i) => d.time - data[i].time).sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
};

/**
 * EMA computed on higher-timeframe bars, lined up with the chart's bars (the way TradingView's
 * request.security works). A chart bar takes the EMA of the last *completed* higher-timeframe bar,
 * so history never peeks ahead; the bar that is still open uses a developing EMA that includes the
 * latest price. Chart bars before the first higher-timeframe bar get NaN.
 */
export const alignHtfEma = (chart: ChartData[], htf: ChartData[], htfMs: number, period: number): number[] => {
  const out: number[] = chart.map(() => NaN);
  if (!htf.length || !chart.length) return out;

  const closes = htf.map((b) => b.close);
  // while the last higher-timeframe bar is still forming, track it with the chart's live price
  const lastBar = htf[htf.length - 1];
  const lastChart = chart[chart.length - 1];
  if (lastChart.time >= lastBar.time && lastChart.time < lastBar.time + htfMs) {
    closes[closes.length - 1] = lastChart.close;
  }
  const ema = calculateEMAFromFirst(closes, period);

  let k = 0; // index of the higher-timeframe bar containing the current chart bar
  for (let i = 0; i < chart.length; i++) {
    while (k + 1 < htf.length && htf[k + 1].time <= chart[i].time) k++;
    if (htf[k].time > chart[i].time) continue; // chart bar is before any higher-timeframe data
    out[i] = k === htf.length - 1 ? ema[k] : k > 0 ? ema[k - 1] : NaN;
  }
  return out;
};

/** Merge finer bars into bars of `ms`, aligned to clock boundaries (e.g. 5m bars into 10m bars) */
export const aggregateBars = (bars: ChartData[], ms: number): ChartData[] => {
  const out: ChartData[] = [];
  for (const b of bars) {
    const start = Math.floor(b.time / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b, time: start });
    }
  }
  return out;
};
