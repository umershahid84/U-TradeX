import { ChartData } from '../types';
import {
  calculateBollingerBands,
  calculateEMAFromFirst,
  calculateMACDSeries,
  calculateRSISeries,
  calculateVWAP,
} from './indicators';

export type Bias = 'calls' | 'puts' | 'neutral';

export interface BiasSignal {
  name: string;
  /** -1 (bearish) to +1 (bullish) */
  value: number;
  weight: number;
  detail: string;
}

export interface BiasResult {
  bias: Bias;
  /** -100 (strongly bearish) to +100 (strongly bullish) */
  score: number;
  strength: 'strong' | 'moderate' | 'weak';
  signals: BiasSignal[];
  cautions: string[];
  headline: string;
}

export const MIN_BARS = 50;

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const last = <T,>(a: T[]) => a[a.length - 1];
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

/**
 * Reads the chart the user is looking at and says whether the technicals lean towards buying
 * calls (bullish) or puts (bearish). Each indicator votes from -1 to +1; the weighted average
 * becomes a -100..+100 score. This describes current momentum, not a forecast.
 */
export const analyzeBias = (data: ChartData[]): BiasResult | null => {
  if (data.length < MIN_BARS) return null;

  const closes = data.map((d) => d.close);
  const price = last(closes);
  const signals: BiasSignal[] = [];
  const cautions: string[] = [];

  // 1. Trend: price against the 21 and 50 EMAs, and whether those are stacked in order
  const ema21 = last(calculateEMAFromFirst(closes, 21));
  const ema50 = last(calculateEMAFromFirst(closes, 50));
  {
    let v = 0;
    v += price > ema21 ? 0.35 : -0.35;
    v += price > ema50 ? 0.35 : -0.35;
    v += ema21 > ema50 ? 0.3 : -0.3;
    const stacked = v > 0.9 ? 'Price above rising EMA 21 and 50' : v < -0.9 ? 'Price below falling EMA 21 and 50' : 'Price is mixed around the EMA 21 / 50';
    signals.push({ name: 'Trend (EMA 21/50)', value: v, weight: 22, detail: stacked });
  }

  // 2. Short-term Ripster clouds (8/9 and 5/12)
  {
    const e = (p: number) => last(calculateEMAFromFirst(closes, p));
    const [e5, e8, e9, e12] = [e(5), e(8), e(9), e(12)];
    const top = Math.max(e5, e8, e9, e12);
    const bottom = Math.min(e5, e8, e9, e12);
    let v = 0;
    if (price > top && e8 > e9 && e5 > e12) v = 1;
    else if (price < bottom && e8 < e9 && e5 < e12) v = -1;
    else v = clamp(((price - (top + bottom) / 2) / price) * 80) * 0.5;
    signals.push({
      name: 'Ripster clouds (5/12, 8/9)',
      value: v,
      weight: 15,
      detail: v >= 1 ? 'Price above both clouds, bullish' : v <= -1 ? 'Price below both clouds, bearish' : price > bottom && price < top ? 'Price inside the cloud, no clear direction' : 'Clouds are not aligned',
    });
  }

  // 3. MACD histogram and whether it is strengthening
  {
    const { histogram } = calculateMACDSeries(closes);
    const h = last(histogram);
    const prev = histogram[histogram.length - 2];
    if (Number.isFinite(h) && Number.isFinite(prev)) {
      const rising = h > prev;
      const v = h > 0 ? (rising ? 1 : 0.3) : rising ? -0.3 : -1;
      signals.push({
        name: 'MACD',
        value: v,
        weight: 15,
        detail: `${h > 0 ? 'Positive' : 'Negative'} histogram, ${rising ? 'strengthening' : 'weakening'}`,
      });
    }
  }

  // 4. RSI: momentum zone, with overbought/oversold as cautions rather than reversals
  {
    const rsi = last(calculateRSISeries(closes, 14));
    if (Number.isFinite(rsi)) {
      const v = clamp((rsi - 50) / 20);
      signals.push({
        name: 'RSI (14)',
        value: rsi > 70 ? 0.3 : rsi < 30 ? -0.3 : v,
        weight: 15,
        detail: `RSI ${rsi.toFixed(0)}${rsi > 70 ? ', overbought' : rsi < 30 ? ', oversold' : rsi > 55 ? ', bullish momentum' : rsi < 45 ? ', bearish momentum' : ', neutral'}`,
      });
      if (rsi > 70) cautions.push('RSI is overbought, so a pullback is more likely. Late call buyers risk buying the top.');
      if (rsi < 30) cautions.push('RSI is oversold, so a bounce is more likely. Late put buyers risk buying the bottom.');
    }
  }

  // 4b. VWAP, only meaningful on intraday bars
  const intraday = data.length > 1 && data[1].time - data[0].time < 20 * 60 * 60 * 1000;
  if (intraday) {
    const vwap = last(calculateVWAP(data));
    const dist = (price - vwap) / vwap;
    signals.push({
      name: 'VWAP',
      value: clamp(dist * 100),
      weight: 10,
      detail: `Price ${price > vwap ? 'above' : 'below'} VWAP (${pct(dist)})`,
    });
  }

  // 5. Bollinger %B
  {
    const bb = calculateBollingerBands(closes, 20, 2);
    const up = last(bb.upper), lo = last(bb.lower);
    if (Number.isFinite(up) && Number.isFinite(lo) && up > lo) {
      const pb = (price - lo) / (up - lo);
      signals.push({
        name: 'Bollinger Bands',
        value: clamp((pb - 0.5) * 2) * 0.6,
        weight: 8,
        detail: `Price at ${(pb * 100).toFixed(0)}% of the band${pb > 1 ? ', above the upper band' : pb < 0 ? ', below the lower band' : ''}`,
      });
      if (pb > 1) cautions.push('Price is above the upper Bollinger Band, which is stretched.');
      if (pb < 0) cautions.push('Price is below the lower Bollinger Band, which is stretched.');
    }
  }

  // 6. Momentum: rate of change over 10 bars
  {
    const back = closes[closes.length - 11];
    if (back) {
      const roc = price / back - 1;
      signals.push({
        name: 'Momentum (10 bars)',
        value: clamp(roc * 60),
        weight: 10,
        detail: `${pct(roc)} over the last 10 bars`,
      });
    }
  }

  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  const score = Math.round((signals.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight) * 100);

  // Signals pulling in opposite directions lower confidence
  const bulls = signals.filter((s) => s.value > 0.25).length;
  const bears = signals.filter((s) => s.value < -0.25).length;
  if (bulls >= 2 && bears >= 2) cautions.push('Indicators disagree with each other, so the signal is less reliable.');

  // Price far from its trend EMA is an extended move
  const stretch = (price - ema21) / ema21;
  if (Math.abs(stretch) > 0.03) {
    cautions.push(`Price is ${pct(stretch)} from its EMA 21. Extended moves often pause or pull back before continuing.`);
  }

  const abs = Math.abs(score);
  const bias: Bias = score >= 25 ? 'calls' : score <= -25 ? 'puts' : 'neutral';
  const strength = abs >= 55 ? 'strong' : abs >= 35 ? 'moderate' : 'weak';
  const headline =
    bias === 'neutral'
      ? 'Mixed signals: consider waiting for a clearer setup'
      : `${strength[0].toUpperCase()}${strength.slice(1)} ${bias === 'calls' ? 'bullish' : 'bearish'} lean: ${bias === 'calls' ? 'Calls' : 'Puts'} favored`;

  return { bias, score, strength, signals, cautions, headline };
};
