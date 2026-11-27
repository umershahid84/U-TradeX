import { ChartData } from '../types';
import { movingAverage, sourceValue } from './htfEma';
import { etClock } from './lateDay';

// Air gap: empty space between two EMA clouds. When price breaks out of its own cloud and the next cloud in that
// direction is far away, nothing on the chart (no EMA) stands in the way, and the next cloud's near edge is the target.

/** EMA pairs, fastest first: the cloud price trades in, then the ones further out */
export const CLOUD_PAIRS: { a: number; b: number }[] = [
  { a: 5, b: 12 },
  { a: 34, b: 50 },
  { a: 72, b: 89 },
  { a: 180, b: 200 },
];

export interface GapCloud {
  label: string;
  top: number;
  bottom: number;
  /** The EMA length on each edge, for naming a target ("72 EMA") */
  topLen: number;
  bottomLen: number;
}

export type GapState = 'setup' | 'entry' | 'running' | 'target';

export interface AirGapSetup {
  symbol: string;
  side: 'long' | 'short';
  price: number;
  /** ATR of the chart's candles */
  atr: number;
  /** Average daily range over the last ~14 days, and how much of it is left today (null without daily data) */
  dailyAtr: number | null;
  atrLeft: number | null;
  /** Fast cloud edge price breaks through, and the opposite edge where the idea is wrong */
  entry: number;
  stop: number;
  target: number;
  targetLabel: string;
  /** Dollars and percent from the price to the target, and in ATRs */
  room: number;
  roomPct: number;
  roomAtr: number;
  /** ATR left today divided by the room: 1 or more means the day's usual range still covers the move */
  reach: number | null;
  /** Fast cloud above the slow one (long) or below (short): the trend agrees */
  aligned: boolean;
  state: GapState;
  /** Candle time of the break through the fast cloud, when there was a recent one */
  breakTime: number | null;
  /** The empty space: from where price is to the next cloud */
  gapFrom: number;
  gapTo: number;
  score: number;
  /** Where the candles came from: Moomoo's live candles, or Yahoo (delayed) */
  source: 'moomoo' | 'yahoo';
  /** Time of the newest candle used (a closed market shows the last session) */
  asOf: number;
  clouds: GapCloud[];
}

const atrOf = (bars: ChartData[], period = 14): number => {
  const n = bars.length;
  if (n < 2) return 0;
  const tr = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
  const last = tr.slice(-period);
  return last.reduce((s, x) => s + x, 0) / last.length;
};

/** Average high-low range of the last 14 finished days (null with fewer than 5) */
export const dailyRange = (daily: ChartData[]): number | null => {
  if (daily.length < 6) return null;
  const done = daily.slice(0, -1).slice(-14);
  return done.reduce((s, b) => s + (b.high - b.low), 0) / done.length;
};

export interface AirGapOpts {
  /** A break counts as a fresh entry for this many candles */
  freshBars: number;
}
export const DEFAULT_GAP_OPTS: AirGapOpts = { freshBars: 6 };

/**
 * The air gap in front of a symbol, if there is one: the direction follows where price sits against its fast (5/12)
 * cloud (above: long, below: short; inside it, the trend between the fast and slow clouds), and the target is the near
 * edge of the next cloud that way. Returns null when no cloud lies ahead or there is too little history.
 */
export const findAirGap = (symbol: string, bars: ChartData[], dailyAtr: number | null, opts: Partial<AirGapOpts> = {}, source: 'moomoo' | 'yahoo' = 'yahoo'): AirGapSetup | null => {
  const o = { ...DEFAULT_GAP_OPTS, ...opts };
  const n = bars.length;
  if (n < 60) return null;
  const hl2 = bars.map((b) => sourceValue(b, 'hl2'));
  const emas = new Map<number, number[]>();
  const ema = (len: number) => {
    let e = emas.get(len);
    if (!e) emas.set(len, (e = movingAverage(hl2, len, 'EMA')));
    return e;
  };
  const price = bars[n - 1].close;
  const atr = atrOf(bars);
  if (!(atr > 0) || !(price > 0)) return null;

  // clouds as they stand now; the longest pairs need enough candles to have settled
  const clouds: (GapCloud & { idx: number })[] = [];
  CLOUD_PAIRS.forEach((p, idx) => {
    if (n < p.b + 10) return;
    const a = ema(p.a)[n - 1], b = ema(p.b)[n - 1];
    clouds.push({ idx, label: `${p.a}/${p.b}`, top: Math.max(a, b), bottom: Math.min(a, b), topLen: a >= b ? p.a : p.b, bottomLen: a >= b ? p.b : p.a });
  });
  const fast = clouds.find((c) => c.idx === 0);
  const slow = clouds.find((c) => c.idx === 1);
  if (!fast || clouds.length < 2) return null;

  const above = price > fast.top, below = price < fast.bottom;
  const bullBias = slow ? fast.top + fast.bottom >= slow.top + slow.bottom : true;
  const side: 'long' | 'short' = above ? 'long' : below ? 'short' : bullBias ? 'long' : 'short';
  const long = side === 'long';

  // the next cloud ahead of price in that direction (never the fast cloud itself)
  const ahead = clouds
    .filter((c) => c.idx !== 0 && (long ? c.bottom > Math.max(price, fast.top) : c.top < Math.min(price, fast.bottom)))
    .sort((x, y) => (long ? x.bottom - y.bottom : y.top - x.top))[0];
  if (!ahead) return null;
  const target = long ? ahead.bottom : ahead.top;
  const targetLabel = `${long ? ahead.bottomLen : ahead.topLen} EMA`;
  const room = Math.abs(target - price);
  const gapFrom = long ? Math.max(price, fast.top) : Math.min(price, fast.bottom);

  // when price last closed through the fast cloud's edge in this direction
  const fTop = ema(CLOUD_PAIRS[0].a), fBot = ema(CLOUD_PAIRS[0].b);
  const topAt = (i: number) => Math.max(fTop[i], fBot[i]);
  const botAt = (i: number) => Math.min(fTop[i], fBot[i]);
  let breakIdx = -1;
  for (let i = n - 1; i >= Math.max(1, n - 40); i--) {
    const crossedUp = bars[i].close > topAt(i) && bars[i - 1].close <= topAt(i - 1);
    const crossedDn = bars[i].close < botAt(i) && bars[i - 1].close >= botAt(i - 1);
    if (long ? crossedUp : crossedDn) { breakIdx = i; break; }
    // price went back through the cloud since: that break is over
    if (long ? bars[i].close < botAt(i) : bars[i].close > topAt(i)) break;
  }
  const stillOut = long ? above : below;
  let state: GapState = 'setup';
  if (breakIdx >= 0 && stillOut) state = n - 1 - breakIdx < o.freshBars ? 'entry' : 'running';
  else if (stillOut) state = 'running';
  // target reached since the break
  if (breakIdx >= 0) {
    for (let i = breakIdx; i < n; i++) if (long ? bars[i].high >= target : bars[i].low <= target) { state = 'target'; break; }
  }

  // how much of today's usual range is left
  let atrLeft: number | null = null;
  if (dailyAtr && dailyAtr > 0) {
    const day = etClock(bars[n - 1].time).date;
    let hi = -Infinity, lo = Infinity;
    for (let i = n - 1; i >= 0 && etClock(bars[i].time).date === day; i--) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low); }
    atrLeft = Math.max(0, dailyAtr - (hi - lo));
  }
  const reach = atrLeft !== null && room > 0 ? atrLeft / room : null;
  const aligned = slow ? (long ? fast.top + fast.bottom > slow.top + slow.bottom : fast.top + fast.bottom < slow.top + slow.bottom) : true;
  const roomAtr = room / atr;

  // ranking: more room (in ATRs) is better, but only as far as the day's range can cover it
  const weight = state === 'entry' ? 1.25 : state === 'running' ? 1 : state === 'setup' ? 0.7 : 0;
  const score = Math.min(roomAtr, 8) * Math.min(1, reach ?? 1) * weight * (aligned ? 1.1 : 0.85);

  return {
    symbol, side, price, atr, dailyAtr, atrLeft,
    entry: long ? fast.top : fast.bottom,
    stop: long ? fast.bottom - atr * 0.1 : fast.top + atr * 0.1,
    target, targetLabel, room, roomPct: (room / price) * 100, roomAtr, reach, aligned, state,
    breakTime: breakIdx >= 0 ? bars[breakIdx].time : null,
    gapFrom, gapTo: target, score, source, asOf: bars[n - 1].time,
    clouds: clouds.map(({ idx: _i, ...c }) => c),
  };
};

/** How close the 5 and 12 EMA must be, in ATRs, to call a curl possible */
export const CURL_MAX_GAP_ATR = 1.0;

export interface CurlSetup {
  symbol: string;
  /** up: the 5 EMA is turning up under the 12 EMA (a bullish cross may follow); down: the reverse */
  side: 'up' | 'down';
  price: number;
  /** Distance between the 5 and 12 EMA, in ATRs */
  gapAtr: number;
  /** Rough number of candles until they cross at the current closing speed (null when they are not closing) */
  eta: number | null;
  source: 'moomoo' | 'yahoo';
  asOf: number;
}

/**
 * A possible 5/12 curl: the fast EMAs are about to cross. The 5 EMA sits on the wrong side of the 12 EMA, has recently turned
 * toward it and the two are within about one ATR and closing, so the 5/12 cloud may flip direction.
 * It is an early warning, earlier than a close through the cloud, and fails more often.
 */
export const findCurl = (symbol: string, bars: ChartData[], source: 'moomoo' | 'yahoo' = 'yahoo'): CurlSetup | null => {
  const n = bars.length;
  if (n < 40) return null;
  const hl2 = bars.map((b) => sourceValue(b, 'hl2'));
  const e5 = movingAverage(hl2, 5, 'EMA');
  const e12 = movingAverage(hl2, 12, 'EMA');
  const atr = atrOf(bars);
  if (!(atr > 0)) return null;
  const d = (i: number) => e5[i] - e12[i];
  const now = d(n - 1);
  if (now === 0) return null;
  const up = now < 0;
  const gap = Math.abs(now);
  // the 5 EMA turned toward the 12 EMA within the last five candles and is moving that way now
  const toward = (i: number) => (up ? e5[i] > e5[i - 1] : e5[i] < e5[i - 1]);
  const away = (i: number) => (up ? e5[i] <= e5[i - 1] : e5[i] >= e5[i - 1]);
  const turned = toward(n - 1) && [2, 3, 4, 5].some((k) => away(n - k));
  const closing = Math.abs(d(n - 2)) > gap;
  if (!turned || !closing || gap > atr * CURL_MAX_GAP_ATR) return null;
  // not just a flat tape: the 5 and 12 EMA were really apart a few candles ago, and the 5 EMA is actually moving now
  let peak = 0;
  for (let k = 0; k < 10; k++) if (d(n - 1 - k) * now > 0) peak = Math.max(peak, Math.abs(d(n - 1 - k)));
  if (peak < atr * 0.8 || gap < atr * 0.05 || Math.abs(e5[n - 1] - e5[n - 2]) < atr * 0.03) return null;
  const speed = (Math.abs(d(n - 3)) - gap) / 2;
  return {
    symbol, side: up ? 'up' : 'down', price: bars[n - 1].close, gapAtr: gap / atr,
    eta: speed > 0 ? Math.min(20, Math.max(1, Math.round(gap / speed))) : null, source, asOf: bars[n - 1].time,
  };
};
