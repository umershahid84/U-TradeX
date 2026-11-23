import type { OptionChain } from '../services/realMarketData';

// Estimated dealer gamma exposure (GEX) from open interest. Convention (the same one other GEX tools use):
// dealers are assumed long the calls and short the puts that customers hold, so call gamma counts as positive and
// put gamma as negative. It is an estimate from public open interest, not an exchange figure.

export interface Gex {
  spot: number;
  /** Strike with the largest positive (call) gamma */
  callWall: number | null;
  /** Strike with the largest negative (put) gamma */
  putWall: number | null;
  /** Price where the total flips from positive to negative gamma, nearest to spot */
  flip: number | null;
  /** Dollars of delta dealers re-hedge for a 1% move in the stock; negative amplifies moves */
  net: number;
  expirations: number;
  strikes: { strike: number; call: number; put: number }[];
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Black-Scholes gamma per share (zero rate and dividends) */
export const bsGamma = (spot: number, strike: number, iv: number, years: number): number => {
  if (!(spot > 0 && strike > 0 && iv > 0 && years > 0)) return 0;
  const sd = iv * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + 0.5 * sd * sd) / sd;
  return Math.exp(-0.5 * d1 * d1) / SQRT_2PI / (spot * sd);
};

export const computeGex = (chains: OptionChain[], spot: number, now = Date.now()): Gex | null => {
  if (!(spot > 0) || !chains.length) return null;
  type Row = { strike: number; oi: number; iv: number; years: number; sign: 1 | -1 };
  const rows: Row[] = [];
  for (const c of chains) {
    // contracts expire at the 4pm New York close, about 20:30 UTC on average across the year
    const expiry = Date.parse(`${c.expirationDate}T20:30:00Z`);
    // a contract expiring today still has a few hours: never less than a quarter of a trading day
    const years = Math.max(expiry - now, 2 * 3600 * 1000) / YEAR_MS;
    for (const k of c.calls) if (k.openInterest > 0 && k.impliedVolatility > 0.01) rows.push({ strike: k.strike, oi: k.openInterest, iv: k.impliedVolatility, years, sign: 1 });
    for (const k of c.puts) if (k.openInterest > 0 && k.impliedVolatility > 0.01) rows.push({ strike: k.strike, oi: k.openInterest, iv: k.impliedVolatility, years, sign: -1 });
  }
  if (!rows.length) return null;
  const gexAt = (s: number, r: Row) => r.sign * bsGamma(s, r.strike, r.iv, r.years) * r.oi * 100 * s * s * 0.01;

  const byStrike = new Map<number, { call: number; put: number }>();
  for (const r of rows) {
    const e = byStrike.get(r.strike) ?? { call: 0, put: 0 };
    const g = gexAt(spot, r);
    if (r.sign > 0) e.call += g;
    else e.put += g;
    byStrike.set(r.strike, e);
  }
  const strikes = [...byStrike.entries()].map(([strike, v]) => ({ strike, ...v })).sort((a, b) => a.strike - b.strike);
  // walls are only meaningful near the price: within 15%
  const near = strikes.filter((s) => Math.abs(s.strike / spot - 1) <= 0.15);
  const pool = near.length ? near : strikes;
  // call wall: the biggest call gamma at or above the price; put wall: the biggest put gamma at or below it
  const above = pool.filter((s) => s.strike >= spot);
  const below = pool.filter((s) => s.strike <= spot);
  const callWall = (above.length ? above : pool).reduce<{ strike: number; call: number } | null>((b, s) => (s.call > 0 && (!b || s.call > b.call) ? s : b), null);
  const putWall = (below.length ? below : pool).reduce<{ strike: number; put: number } | null>((b, s) => (s.put < 0 && (!b || s.put < b.put) ? s : b), null);

  const net = strikes.reduce((a, s) => a + s.call + s.put, 0);
  // the flip: total gamma if the stock were at each price from -10% to +10%; nearest sign change to spot
  const total = (s: number) => rows.reduce((a, r) => a + gexAt(s, r), 0);
  const grid: { p: number; g: number }[] = [];
  for (let i = -40; i <= 40; i++) {
    const p = spot * (1 + i * 0.0025);
    grid.push({ p, g: total(p) });
  }
  let flip: number | null = null;
  let best = Infinity;
  for (let i = 1; i < grid.length; i++) {
    const a = grid[i - 1], b = grid[i];
    if ((a.g <= 0 && b.g > 0) || (a.g >= 0 && b.g < 0)) {
      const p = a.p + ((b.p - a.p) * (0 - a.g)) / (b.g - a.g);
      if (Math.abs(p - spot) < best) {
        best = Math.abs(p - spot);
        flip = p;
      }
    }
  }
  return {
    spot,
    callWall: callWall ? callWall.strike : null,
    putWall: putWall ? putWall.strike : null,
    flip: flip === null ? null : Math.round(flip * 100) / 100,
    net,
    expirations: chains.length,
    strikes,
  };
};

export const fmtGex = (n: number): string => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${Math.round(a / 1e3)}K`;
  return `${n < 0 ? '-' : '+'}$${s}`;
};
