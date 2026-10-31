import React from 'react';
import { MarketFearGreed } from '../types';
import './FearGreedChip.css';

interface Props {
  market: MarketFearGreed | null;
  onClick: () => void;
}

const colorFor = (s: number) => (s < 25 ? '#ef5350' : s < 45 ? '#ff9800' : s < 55 ? '#ffc107' : s < 75 ? '#8bc34a' : '#26a69a');
const labelFor = (s: number) => (s < 25 ? 'Extreme fear' : s < 45 ? 'Fear' : s < 55 ? 'Neutral' : s < 75 ? 'Greed' : 'Extreme greed');

/** Small market Fear & Greed reading for the top bar; opens the Sentiment tab */
export const FearGreedChip: React.FC<Props> = ({ market, onClick }) => {
  if (!market) return null;
  const c = colorFor(market.score);
  return (
    <button type="button" className="fg-chip" onClick={onClick} title="Market Fear & Greed Index. Click for details">
      <span className="fg-chip-label">Fear &amp; Greed</span>
      <span className="fg-chip-bar"><i style={{ left: `${Math.max(0, Math.min(100, market.score))}%` }} /></span>
      <span className="fg-chip-value" style={{ color: c }}>{Math.round(market.score)}</span>
      <span className="fg-chip-text" style={{ color: c }}>{labelFor(market.score)}</span>
    </button>
  );
};
