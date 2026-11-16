import { ChartData } from '../types';

export type PlanSide = 'long' | 'short';

export interface PlanInput {
  side: PlanSide;
  entry: number;
  stop: number;
  target: number;
  /** Percent of account equity risked if the stop is hit */
  riskPct: number;
  equity: number;
  /** Cash available for the entry */
  balance: number;
}

export interface PlanResult {
  valid: boolean;
  problem?: string;
  riskPerShare: number;
  rewardPerShare: number;
  /** Reward to risk, e.g. 2 means 2R */
  rr: number;
  qty: number;
  /** Dollars lost if the stop is hit at the planned size */
  riskAmount: number;
  rewardAmount: number;
  cost: number;
  /** Size was reduced to fit the cash available */
  cappedByCash: boolean;
}

export const planResult = (p: PlanInput): PlanResult => {
  const blank = { riskPerShare: 0, rewardPerShare: 0, rr: 0, qty: 0, riskAmount: 0, rewardAmount: 0, cost: 0, cappedByCash: false };
  const bad = (problem: string): PlanResult => ({ ...blank, valid: false, problem });
  if (![p.entry, p.stop, p.target].every((x) => Number.isFinite(x) && x > 0)) return bad('Enter entry, stop and target prices');
  const long = p.side === 'long';
  if (long && !(p.stop < p.entry && p.entry < p.target)) return bad('For a long, the stop must be below the entry and the target above it');
  if (!long && !(p.target < p.entry && p.entry < p.stop)) return bad('For a short, the target must be below the entry and the stop above it');

  const riskPerShare = Math.abs(p.entry - p.stop);
  const rewardPerShare = Math.abs(p.target - p.entry);
  const budget = (p.equity * p.riskPct) / 100;
  const byRisk = Math.floor(budget / riskPerShare);
  const byCash = Math.floor(p.balance / p.entry);
  const qty = Math.max(0, Math.min(byRisk, byCash));
  if (qty < 1) return { ...bad('Not enough risk budget or cash for one share'), riskPerShare, rewardPerShare, rr: rewardPerShare / riskPerShare };
  return {
    valid: true,
    riskPerShare,
    rewardPerShare,
    rr: rewardPerShare / riskPerShare,
    qty,
    riskAmount: qty * riskPerShare,
    rewardAmount: qty * rewardPerShare,
    cost: qty * p.entry,
    cappedByCash: byCash < byRisk,
  };
};

/** Wilder's average true range of the last `period` bars (null with too little data) */
export const atr = (bars: ChartData[], period = 14): number | null => {
  if (bars.length < period + 1) return null;
  const tr = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
  let a = tr.slice(1, period + 1).reduce((s, x) => s + x, 0) / period;
  for (let i = period + 1; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
};

/** Starting levels: stop 1.5 ATR from the entry (0.5% if no ATR), target at 2R */
export const defaultPlan = (side: PlanSide, entry: number, atrValue: number | null) => {
  const risk = atrValue && atrValue > 0 ? atrValue * 1.5 : entry * 0.005;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return side === 'long'
    ? { stop: r2(entry - risk), target: r2(entry + risk * 2) }
    : { stop: r2(entry + risk), target: r2(entry - risk * 2) };
};
