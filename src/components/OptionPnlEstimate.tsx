import React from 'react';
import { OptionSide } from '../utils/optionScoring';
import { breakevenPrice, buildScenarios, bsPrice, intrinsicValue, solveIv } from '../utils/optionPricing';

interface Props {
  side: OptionSide;
  spot: number;
  strike: number;
  premium: number;
  contracts: number;
  iv: number | null;
  years: number;
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const signed = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const W = 300, H = 110, PAD = 6;

export const OptionPnlEstimate: React.FC<Props> = ({ side, spot, strike, premium, contracts, iv, years }) => {
  const qty = Math.max(1, contracts);
  const cost = premium * qty * 100;
  const breakeven = breakevenPrice(side, strike, premium);
  const beMove = breakeven / spot - 1;
  // Calibrate to the price being paid so the "Now" row reads about $0
  const calibrated = solveIv(side, spot, strike, premium, years);
  const usableIv = calibrated ?? (iv && iv >= 0.05 ? iv : null);
  const rows = buildScenarios(side, spot, strike, premium, usableIv, years, qty);

  // Payoff diagram across +/-20% of the stock price
  const lo = spot * 0.8, hi = spot * 1.2;
  const xs = Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40);
  const expiryPts = xs.map((x) => intrinsicValue(side, x, strike) * qty * 100 - cost);
  const nowPts = usableIv ? xs.map((x) => bsPrice(side, x, strike, usableIv, years) * qty * 100 - cost) : null;
  const all = [...expiryPts, ...(nowPts ?? [])];
  const yMax = Math.max(...all, 1), yMin = Math.min(...all, -1);
  const sx = (x: number) => PAD + ((x - lo) / (hi - lo)) * (W - 2 * PAD);
  const sy = (y: number) => PAD + ((yMax - y) / (yMax - yMin)) * (H - 2 * PAD);
  const path = (pts: number[]) => pts.map((y, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');

  return (
    <div className="pnl-estimate">
      <h4>Profit / Loss Estimate</h4>

      <div className="pnl-summary">
        <div><label>Max loss</label><span className="loss">{money(-cost)}</span></div>
        <div><label>Max profit</label><span className="gain">{side === 'call' ? 'Unlimited' : money(Math.max(0, strike - premium) * qty * 100)}</span></div>
        <div>
          <label>Breakeven</label>
          <span>${breakeven.toFixed(2)} <small>({beMove >= 0 ? '+' : ''}{(beMove * 100).toFixed(1)}%)</small></span>
        </div>
      </div>

      <svg className="pnl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit and loss by stock price">
        <line x1={PAD} x2={W - PAD} y1={sy(0)} y2={sy(0)} className="axis" />
        <line x1={sx(spot)} x2={sx(spot)} y1={PAD} y2={H - PAD} className="spot" />
        {breakeven >= lo && breakeven <= hi && <line x1={sx(breakeven)} x2={sx(breakeven)} y1={PAD} y2={H - PAD} className="be" />}
        {nowPts && <path d={path(nowPts)} className="line-now" />}
        <path d={path(expiryPts)} className="line-expiry" />
      </svg>
      <div className="pnl-legend">
        <span><i className="sw expiry" /> At expiry</span>
        {nowPts && <span><i className="sw now" /> If it moves today</span>}
        <span><i className="sw spot" /> Current price</span>
      </div>

      <table className="pnl-table">
        <thead>
          <tr>
            <th>Stock</th>
            <th>Price</th>
            {usableIv && <th>P/L today</th>}
            <th>P/L at expiry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.move} className={r.move === 0 ? 'current' : ''}>
              <td>{r.move === 0 ? 'Now' : `${r.move > 0 ? '+' : ''}${(r.move * 100).toFixed(0)}%`}</td>
              <td>${r.price.toFixed(2)}</td>
              {usableIv && <td className={r.pnlNow! >= 0 ? 'gain' : 'loss'}>{signed(r.pnlNow!)}</td>}
              <td className={r.pnlExpiry >= 0 ? 'gain' : 'loss'}>
                {signed(r.pnlExpiry)} <small>({r.pnlExpiryPct >= 0 ? '+' : ''}{r.pnlExpiryPct.toFixed(0)}%)</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pnl-note">
        Estimates for {qty} contract{qty > 1 ? 's' : ''} bought at ${premium.toFixed(2)}, before fees.
        {usableIv
          ? ' "Today" is a Black-Scholes estimate calibrated to this price and assumes volatility stays the same; real prices will differ, especially if volatility changes.'
          : ' Not enough implied volatility data for a "today" estimate.'}
      </div>
    </div>
  );
};
