import { FearGreedData } from '../types';

export const calculateFearGreed = (
  price: number,
  sma20: number,
  sma50: number,
  rsi: number,
  volume: number,
  avgVolume: number
): FearGreedData => {
  // Calculate various factors
  const priceVsSMA = ((price - sma20) / sma20) * 100;
  const trendStrength = ((sma20 - sma50) / sma50) * 100;
  const volumeRatio = volume / avgVolume;

  // Weight different factors
  let score = 50; // Start neutral

  // RSI factor (30-70 range, most important)
  if (rsi < 30) score -= 20;
  else if (rsi < 40) score -= 10;
  else if (rsi > 70) score += 20;
  else if (rsi > 60) score += 10;

  // Price vs moving average
  if (priceVsSMA < -5) score -= 15;
  else if (priceVsSMA < -2) score -= 10;
  else if (priceVsSMA > 5) score += 15;
  else if (priceVsSMA > 2) score += 10;

  // Trend strength
  if (trendStrength < -3) score -= 10;
  else if (trendStrength > 3) score += 10;

  // Volume
  if (volumeRatio > 1.5) score += 5;
  else if (volumeRatio < 0.5) score -= 5;

  // Clamp between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Determine level
  let level: FearGreedData['level'];
  if (score <= 20) level = 'extreme fear';
  else if (score <= 40) level = 'fear';
  else if (score <= 60) level = 'neutral';
  else if (score <= 80) level = 'greed';
  else level = 'extreme greed';

  // Determine signal
  let signal: FearGreedData['signal'];
  const oversold = rsi < 30;
  const overbought = rsi > 70;

  if (oversold && score < 30) signal = 'STRONG BUY';
  else if (score < 40) signal = 'BUY';
  else if (overbought && score > 70) signal = 'STRONG SELL';
  else if (score > 60) signal = 'SELL';
  else signal = 'HOLD';

  return {
    value: Math.round(score),
    level,
    signal,
    oversold,
    overbought,
  };
};

export const calculateSMA = (data: number[], period: number): number[] => {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
};

export const calculateEMA = (data: number[], period: number): number[] => {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  if (data.length < period) return data.map(() => NaN);

  // First EMA is SMA
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      result.push(ema);
    } else {
      ema = (data[i] - ema) * multiplier + ema;
      result.push(ema);
    }
  }
  return result;
};

// RSI series using Wilder's smoothing (the standard definition).
// Entries before index `period` are NaN (not enough data).
export const calculateRSISeries = (prices: number[], period: number = 14): number[] => {
  const result: number[] = prices.map(() => NaN);
  if (prices.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const toRSI = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  result[period] = toRSI();

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = toRSI();
  }
  return result;
};

export const calculateRSI = (prices: number[], period: number = 14): number => {
  const series = calculateRSISeries(prices, period);
  const last = series[series.length - 1];
  return isNaN(last) ? 50 : last;
};

// MACD series (12/26/9). Each array is aligned with `prices`; warm-up entries are NaN.
export const calculateMACDSeries = (
  prices: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } => {
  const emaFast = calculateEMA(prices, fast);
  const emaSlow = calculateEMA(prices, slow);
  const macd = prices.map((_, i) => emaFast[i] - emaSlow[i]);

  const firstValid = macd.findIndex((v) => !isNaN(v));
  const signal: number[] = prices.map(() => NaN);
  if (firstValid >= 0) {
    const signalValues = calculateEMA(macd.slice(firstValid), signalPeriod);
    signalValues.forEach((v, j) => {
      signal[firstValid + j] = v;
    });
  }
  const histogram = macd.map((v, i) => v - signal[i]);
  return { macd, signal, histogram };
};

export const calculateMACD = (
  prices: number[]
): { macd: number; signal: number; histogram: number } => {
  const { macd, signal, histogram } = calculateMACDSeries(prices);
  const last = prices.length - 1;
  return {
    macd: macd[last] || 0,
    signal: signal[last] || 0,
    histogram: histogram[last] || 0,
  };
};

// Ripster EMA Cloud (8, 9, 5, 13 EMAs) with Trend Detection
export const calculateRipsterEMACloud = (prices: number[]) => {
  const ema5 = calculateEMA(prices, 5);
  const ema8 = calculateEMA(prices, 8);
  const ema9 = calculateEMA(prices, 9);
  const ema13 = calculateEMA(prices, 13);
  
  return {
    ema5,
    ema8,
    ema9,
    ema13,
  };
};

// MTF (Multi-Time Frame) Clouds - EMA 34, 50, 72 for cloud visualization
export const calculateMTFClouds = (prices: number[]) => {
  const ema34 = calculateEMA(prices, 34);
  const ema50 = calculateEMA(prices, 50);
  const ema72 = calculateEMA(prices, 72);
  
  return {
    ema34,
    ema50,
    ema72,
  };
};

// Ripster Trend Detection
// Bullish: Price > EMA5 > EMA8 > EMA9 > EMA13
// Bearish: Price < EMA5 < EMA8 < EMA9 < EMA13
export const calculateRipsterTrend = (
  price: number,
  ema5: number,
  ema8: number,
  ema9: number,
  ema13: number
): 'bullish' | 'bearish' | 'neutral' => {
  if (price > ema5 && ema5 > ema8 && ema8 > ema9 && ema9 > ema13) {
    return 'bullish';
  } else if (price < ema5 && ema5 < ema8 && ema8 < ema9 && ema9 < ema13) {
    return 'bearish';
  }
  return 'neutral';
};

// VWAP calculation. For intraday data it resets at the start of each trading day
// (New York date); for daily and higher bars it accumulates over the whole series.
export const calculateVWAP = (
  data: { time?: number; close: number; volume: number; high: number; low: number }[]
): number[] => {
  const result: number[] = [];
  const dayKey = (t: number) =>
    new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const hasTime = data.length > 1 && typeof data[0].time === 'number';
  const intraday =
    hasTime && (data[1].time as number) - (data[0].time as number) < 20 * 60 * 60 * 1000;

  let cumulativeTPV = 0; // Typical Price * Volume
  let cumulativeVolume = 0;
  let currentDay = '';

  for (let i = 0; i < data.length; i++) {
    if (intraday) {
      const key = dayKey(data[i].time as number);
      if (key !== currentDay) {
        currentDay = key;
        cumulativeTPV = 0;
        cumulativeVolume = 0;
      }
    }
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;

    result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
  }

  return result;
};

// Bollinger Bands calculation
export const calculateBollingerBands = (
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } => {
  const middle = calculateSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      
      upper.push(mean + stdDev * std);
      lower.push(mean - stdDev * std);
    }
  }

  return { upper, middle, lower };
};
