import { OptionSide, daysToExpiry, normCdf } from './optionScoring';

const RISK_FREE_RATE = 0.045;

/** Value of the option at expiry: what it is worth if exercised, per share */
export const intrinsicValue = (side: OptionSide, spot: number, strike: number): number =>
  Math.max(0, side === 'call' ? spot - strike : strike - spot);

/**
 * Black-Scholes price per share. It assumes European exercise and no dividends, so it is an
 * estimate: close for out-of-the-money options, rougher for deep in-the-money puts.
 * With no time left (or no usable volatility) the price collapses to intrinsic value.
 */
export const bsPrice = (side: OptionSide, spot: number, strike: number, iv: number, years: number): number => {
  if (years <= 0 || !(iv > 0) || spot <= 0 || strike <= 0) return intrinsicValue(side, spot, strike);
  const vol = iv * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (RISK_FREE_RATE + (iv * iv) / 2) * years) / vol;
  const d2 = d1 - vol;
  const discount = Math.exp(-RISK_FREE_RATE * years);
  return side === 'call'
    ? spot * normCdf(d1) - strike * discount * normCdf(d2)
    : strike * discount * normCdf(-d2) - spot * normCdf(-d1);
};

/**
 * Volatility that makes the model price equal the given premium (bisection). Calibrating to the
 * price actually paid means a new position starts at about zero P/L instead of showing a gap
 * between the model and the market. Returns null when no volatility can explain the premium.
 */
export const solveIv = (side: OptionSide, spot: number, strike: number, premium: number, years: number): number | null => {
  if (years <= 0 || premium <= intrinsicValue(side, spot, strike) + 1e-6) return null;
  let lo = 0.01, hi = 5;
  if (bsPrice(side, spot, strike, hi, years) < premium || bsPrice(side, spot, strike, lo, years) > premium) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(side, spot, strike, mid, years) < premium) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

export const yearsToExpiry = (expiry: string, now = Date.now()): number => daysToExpiry(expiry, now) / 365;

export interface ScenarioRow {
  /** Underlying move from the current price, as a fraction */
  move: number;
  price: number;
  /** Total P/L in dollars if the stock gets there right now */
  pnlNow: number | null;
  /** Total P/L in dollars if the stock is there at expiry */
  pnlExpiry: number;
  pnlExpiryPct: number;
}

export const breakevenPrice = (side: OptionSide, strike: number, premium: number): number =>
  side === 'call' ? strike + premium : strike - premium;

/** What-if table: P/L for a long position at a range of underlying prices */
export const buildScenarios = (
  side: OptionSide,
  spot: number,
  strike: number,
  premium: number,
  iv: number | null,
  years: number,
  contracts: number,
  moves = [-0.15, -0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 0.15]
): ScenarioRow[] => {
  const cost = premium * contracts * 100;
  return moves.map((move) => {
    const price = spot * (1 + move);
    const atExpiry = intrinsicValue(side, price, strike) * contracts * 100;
    const now = iv ? bsPrice(side, price, strike, iv, years) * contracts * 100 : null;
    return {
      move,
      price,
      pnlNow: now === null ? null : now - cost,
      pnlExpiry: atExpiry - cost,
      pnlExpiryPct: cost > 0 ? ((atExpiry - cost) / cost) * 100 : 0,
    };
  });
};
