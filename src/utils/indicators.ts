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

export const calculateRSI = (prices: number[], period: number = 14): number => {
  if (prices.length < period + 1) return 50;

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));

  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const calculateMACD = (
  prices: number[]
): { macd: number; signal: number; histogram: number } => {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  const macdLine = ema12.map((val, i) => val - ema26[i]);
  const signalLine = calculateEMA(macdLine.filter(v => !isNaN(v)), 9);
  
  const macd = macdLine[macdLine.length - 1] || 0;
  const signal = signalLine[signalLine.length - 1] || 0;
  const histogram = macd - signal;
  
  return { macd, signal, histogram };
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

// VWAP calculation (daily reset for intraday data)
// Note: This is a session-based VWAP that accumulates from the start of the data
// For true daily VWAP, implement session boundary detection
export const calculateVWAP = (data: { close: number; volume: number; high: number; low: number }[]): number[] => {
  const result: number[] = [];
  let cumulativeTPV = 0; // Typical Price * Volume
  let cumulativeVolume = 0;

  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
    
    if (cumulativeVolume > 0) {
      result.push(cumulativeTPV / cumulativeVolume);
    } else {
      result.push(data[i].close);
    }
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
