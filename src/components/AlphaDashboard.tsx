import React from 'react';
import { AlphaDashboard as Dash } from '../utils/alphaSignals';
import { ALPHA_COLORS } from './alphaManager';
import './AlphaDashboard.css';

interface Props {
  dash: Dash | null;
  /** Number of decimals to show for prices */
  decimals: number;
}

/** Summary table in the top-right of the chart: trend, action, confidence, risk, entry zone and levels */
export const AlphaDashboard: React.FC<Props> = ({ dash, decimals }) => {
  if (!dash) return null;
  const f = (n: number) => n.toFixed(decimals);
  const trendBg = ALPHA_COLORS[dash.trendState];
  const dark = dash.trendState === 'profit' || dash.trendState === 'caution';

  return (
    <div className="alpha-dash" role="table" aria-label="Alpha Signals">
      <div className="ad-head">ALPHA SIGNALS</div>
      <div className="ad-row ad-trend" style={{ background: trendBg, color: dark ? '#1a1a1a' : '#fff' }}>Trend: {dash.trend}</div>
      <div className="ad-row">Action: {dash.action}</div>
      <div className="ad-row">Confidence: {dash.confidence}%</div>
      <div className="ad-row">Risk: {dash.risk}</div>
      <div className="ad-row">Entry Zone: {f(dash.entryLow)} - {f(dash.entryHigh)}</div>
      <div className="ad-row">R1: {f(dash.r1)} | R2: {f(dash.r2)}</div>
      <div className="ad-row">S1: {f(dash.s1)} | S2: {f(dash.s2)}</div>
      <div className="ad-note">Original indicator. Not advice.</div>
    </div>
  );
};
