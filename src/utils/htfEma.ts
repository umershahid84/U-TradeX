import { ChartData } from '../types';
import { calculateEMAFromFirst, calculateSMA } from './indicators';
import { sessionAt } from './marketSessions';

export type CloudTf = 'chart' | '1m' | '2m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1wk';

export interface CloudTfOption {
  value: CloudTf;
  label: string;
  /** Compact label for tight spaces */
  short: string;
  /** Bar length in ms (0 for 'chart') */
  ms: number;
  /** Yahoo interval and how much history to load so long EMAs have time to settle */
  interval?: string;
  range?: string;
  /** Yahoo has no such interval: 'bucket' merges bars into clock buckets of `ms`, 'session4h' builds 4-hour bars from hourly ones */
  aggregate?: 'bucket' | 'session4h';
}

const MIN = 60_000;
export const CLOUD_TFS: CloudTfOption[] = [
  { value: 'chart', label: 'Chart timeframe', short: 'Chart', ms: 0 },
  { value: '1m', label: '1 min', short: '1m', ms: MIN, interval: '1m', range: '5d' },
  { value: '2m', label: '2 min', short: '2m', ms: 2 * MIN, interval: '2m', range: '5d' },
  { value: '5m', label: '5 min', short: '5m', ms: 5 * MIN, interval: '5m', range: '5d' },
  // Yahoo has no 10-minute candles: build them from 5-minute ones
  { value: '10m', label: '10 min', short: '10m', ms: 10 * MIN, interval: '5m', range: '5d', aggregate: 'bucket' },
  { value: '15m', label: '15 min', short: '15m', ms: 15 * MIN, interval: '15m', range: '1mo' },
  { value: '30m', label: '30 min', short: '30m', ms: 30 * MIN, interval: '30m', range: '1mo' },
  { value: '1h', label: '1 hour', short: '1h', ms: 60 * MIN, interval: '1h', range: '3mo' },
  // Yahoo has no 4-hour candles: build them from hourly ones
  { value: '4h', label: '4 hour', short: '4h', ms: 4 * 60 * MIN, interval: '1h', range: '6mo', aggregate: 'session4h' },
  { value: '1d', label: 'Daily', short: 'D', ms: 24 * 60 * MIN, interval: '1d', range: '2y' },
  { value: '1wk', label: 'Weekly', short: 'W', ms: 7 * 24 * 60 * MIN, interval: '1wk', range: '5y' },
];

export const tfOption = (tf: CloudTf): CloudTfOption => CLOUD_TFS.find((o) => o.value === tf) ?? CLOUD_TFS[0];

/** Typical bar length of the chart, in ms */
export const chartIntervalMs = (data: { time: number }[]): number => {
  if (data.length < 2) return 0;
  const diffs = data.slice(1).map((d, i) => d.time - data[i].time).sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
};

export type MaType = 'EMA' | 'SMA';
export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';

export const PRICE_SOURCES: { value: PriceSource; label: string }[] = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'hl2', label: 'HL2' },
  { value: 'hlc3', label: 'HLC3' },
  { value: 'ohlc4', label: 'OHLC4' },
];

export const sourceValue = (b: ChartData, src: PriceSource): number => {
  switch (src) {
    case 'open': return b.open;
    case 'high': return b.high;
    case 'low': return b.low;
    case 'hl2': return (b.high + b.low) / 2;
    case 'hlc3': return (b.high + b.low + b.close) / 3;
    case 'ohlc4': return (b.open + b.high + b.low + b.close) / 4;
    default: return b.close;
  }
};

/** EMA seeded with the first value (TradingView style) or SMA with NaN until it has enough bars */
export const movingAverage = (values: number[], period: number, type: MaType): number[] =>
  type === 'SMA' ? calculateSMA(values, period) : calculateEMAFromFirst(values, period);

/** Shift a plot by `offset` bars (positive moves it right, like TradingView's Offset) */
export const shiftSeries = (values: number[], offset: number): number[] => {
  if (!offset) return values;
  return values.map((_, i) => (i - offset >= 0 && i - offset < values.length ? values[i - offset] : NaN));
};

/**
 * Moving average computed on higher-timeframe bars, lined up with the chart's bars (the way
 * TradingView's request.security works). A chart bar takes the average of the last *completed*
 * higher-timeframe bar, so history never peeks ahead; the bar that is still open uses a developing
 * value that includes the latest price. Chart bars before the first higher-timeframe bar get NaN.
 */
export const alignHtfMa = (
  chart: ChartData[],
  htf: ChartData[],
  htfMs: number,
  period: number,
  type: MaType = 'EMA',
  source: PriceSource = 'close'
): number[] => {
  const out: number[] = chart.map(() => NaN);
  if (!htf.length || !chart.length) return out;

  // while the last higher-timeframe bar is still forming, fold the chart's live price into it
  const bars = htf.slice();
  const lastBar = bars[bars.length - 1];
  const lastChart = chart[chart.length - 1];
  if (lastChart.time >= lastBar.time && lastChart.time < lastBar.time + htfMs) {
    bars[bars.length - 1] = {
      ...lastBar,
      close: lastChart.close,
      high: Math.max(lastBar.high, lastChart.close),
      low: Math.min(lastBar.low, lastChart.close),
    };
  }
  const ma = movingAverage(bars.map((b) => sourceValue(b, source)), period, type);

  let k = 0; // index of the higher-timeframe bar containing the current chart bar
  for (let i = 0; i < chart.length; i++) {
    while (k + 1 < htf.length && htf[k + 1].time <= chart[i].time) k++;
    if (htf[k].time > chart[i].time) continue; // chart bar is before any higher-timeframe data
    out[i] = k === htf.length - 1 ? ma[k] : k > 0 ? ma[k - 1] : NaN;
  }
  return out;
};

/** Kept for callers that only need EMA of the close */
export const alignHtfEma = (chart: ChartData[], htf: ChartData[], htfMs: number, period: number): number[] =>
  alignHtfMa(chart, htf, htfMs, period, 'EMA', 'close');

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

const nyDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/**
 * 4-hour bars built from hourly ones. Regular trading hours split at 13:30 New York time (09:30-13:30
 * and 13:30-16:00, as on TradingView); pre-market and after-hours each become one bar per day.
 */
export const aggregate4h = (hourly: ChartData[]): ChartData[] => {
  const out: ChartData[] = [];
  let key = '';
  for (const b of hourly) {
    const session = sessionAt(b.time);
    let bucket: string;
    if (session === 'regular') {
      // Yahoo's hourly bars start at :30 (09:30, 10:30, ...). The first four belong to the morning bar.
      const hm = new Date(b.time).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
      bucket = `${nyDay(b.time)}|regular|${hm < '13:30' ? 'am' : 'pm'}`;
    } else {
      bucket = `${nyDay(b.time)}|${session}`;
    }
    const last = out[out.length - 1];
    if (last && bucket === key) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b });
      key = bucket;
    }
  }
  return out;
};

/** Apply whichever aggregation a timeframe option needs to freshly fetched bars */
export const buildTimeframeBars = (raw: ChartData[], opt: CloudTfOption): ChartData[] =>
  opt.aggregate === 'bucket' ? aggregateBars(raw, opt.ms) : opt.aggregate === 'session4h' ? aggregate4h(raw) : raw;
