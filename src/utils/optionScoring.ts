import { OptionChainData } from '../services/realMarketData';

export type OptionSide = 'call' | 'put';
export type OptionGrade = 'A' | 'B' | 'C' | 'D';

export interface RatedOption {
  expiry: string;
  dte: number;
  side: OptionSide;
  contract: OptionChainData;
  /** Estimated fill price: the bid/ask midpoint */
  mid: number;
  /** Bid/ask spread as a fraction of the midpoint */
  spreadPct: number;
  /** Absolute Black-Scholes delta, a rough probability of finishing in the money */
  delta: number;
  /** Underlying move needed to break even at expiry, as a fraction of the current price */
  breakevenMove: number;
  /** Breakeven move divided by the one-standard-deviation expected move */
  breakevenVsExpected: number;
  /** 0-100 */
  score: number;
  grade: OptionGrade;
  parts: { liquidity: number; delta: number; breakeven: number; time: number };
}

const RISK_FREE_RATE = 0.045;
const DAY_MS = 24 * 60 * 60 * 1000;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Abramowitz & Stegun normal CDF approximation (error < 1e-7)
const normCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

export const daysToExpiry = (expiry: string, now = Date.now()): number => {
  // US options stop trading at 4pm ET; 20:00 UTC is close enough for ranking
  const end = Date.parse(`${expiry}T20:00:00Z`);
  return Math.max(0, (end - now) / DAY_MS);
};

export const optionDelta = (side: OptionSide, spot: number, strike: number, iv: number, years: number): number => {
  const vol = iv * Math.sqrt(years);
  if (vol <= 0) return 0;
  const d1 = (Math.log(spot / strike) + (RISK_FREE_RATE + (iv * iv) / 2) * years) / vol;
  return side === 'call' ? normCdf(d1) : normCdf(-d1);
};

// Peaks at 1 for delta ~0.30 (a good balance of cost and odds), fades to 0 at 0.05 and 0.50
const deltaScore = (d: number): number => (d <= 0.3 ? clamp01((d - 0.05) / 0.25) : clamp01((0.5 - d) / 0.2));

// Best 21-45 days out: enough time for the move, not so much that you overpay for time
const timeScore = (dte: number): number => {
  if (dte < 2) return 0;
  if (dte < 21) return 0.2 + (0.8 * (dte - 2)) / 19;
  if (dte <= 45) return 1;
  return Math.max(0.3, 1 - (0.7 * (dte - 45)) / 75);
};

export const gradeFor = (score: number): OptionGrade =>
  score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';

/**
 * Rates one out-of-the-money contract from 0-100 using four equally explainable parts:
 *  - liquidity (30%): tight bid/ask spread, open interest and volume
 *  - delta (30%): odds of finishing in the money, best around 0.30
 *  - breakeven (20%): how far the stock must move to profit, vs the move the market expects
 *  - time (20%): days to expiry, best 3-6 weeks
 * Spreads over 25% cap the grade at B, and over 50% at D.
 * Returns null for contracts that cannot be rated (no quote, no usable IV, already ITM).
 */
export const rateOption = (
  side: OptionSide,
  expiry: string,
  contract: OptionChainData,
  spot: number,
  now = Date.now()
): RatedOption | null => {
  const otm = side === 'call' ? contract.strike > spot : contract.strike < spot;
  if (!otm || contract.inTheMoney) return null;
  if (!(contract.bid > 0) || !(contract.ask >= contract.bid)) return null;
  // Yahoo reports near-zero IV for stale quotes, which would make the delta meaningless
  if (!(contract.impliedVolatility >= 0.05) || contract.impliedVolatility > 5) return null;

  const mid = (contract.bid + contract.ask) / 2;
  if (mid < 0.05) return null;

  const dte = daysToExpiry(expiry, now);
  const years = Math.max(dte, 0.25) / 365;
  const delta = optionDelta(side, spot, contract.strike, contract.impliedVolatility, years);
  const spreadPct = (contract.ask - contract.bid) / mid;

  const breakeven = side === 'call' ? contract.strike + mid : contract.strike - mid;
  const breakevenMove = Math.abs(breakeven - spot) / spot;
  const expectedMove = contract.impliedVolatility * Math.sqrt(years);
  const breakevenVsExpected = breakevenMove / expectedMove;

  const spreadScore = clamp01(1 - spreadPct / 0.2);
  const oiScore = clamp01(Math.log10(1 + contract.openInterest) / Math.log10(1 + 5000));
  const volScore = clamp01(Math.log10(1 + contract.volume) / Math.log10(1 + 1000));
  const parts = {
    liquidity: 0.5 * spreadScore + 0.25 * oiScore + 0.25 * volScore,
    delta: deltaScore(delta),
    breakeven: clamp01(1 - breakevenVsExpected / 1.5),
    time: timeScore(dte),
  };

  let score = 100 * (0.3 * parts.liquidity + 0.3 * parts.delta + 0.2 * parts.breakeven + 0.2 * parts.time);
  // A wide spread eats the edge however good the rest looks, so it caps the grade
  if (spreadPct > 0.5) score = Math.min(score, 44);
  else if (spreadPct > 0.25) score = Math.min(score, 74);
  return {
    expiry, dte, side, contract, mid, spreadPct, delta, breakevenMove, breakevenVsExpected,
    score, grade: gradeFor(score), parts,
  };
};

export const rankOtmOptions = (
  side: OptionSide,
  chains: { expiry: string; calls: OptionChainData[]; puts: OptionChainData[] }[],
  spot: number,
  limit = 8
): RatedOption[] => {
  const rated: RatedOption[] = [];
  for (const chain of chains) {
    for (const c of side === 'call' ? chain.calls : chain.puts) {
      const r = rateOption(side, chain.expiry, c, spot);
      if (r) rated.push(r);
    }
  }
  return rated.sort((a, b) => b.score - a.score).slice(0, limit);
};
