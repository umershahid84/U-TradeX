import React, { useState } from 'react';
import { TimeFrame, TimeRange } from '../types';
import { Logo } from './Logo';
import './Navbar.css';

interface NavbarProps {
  symbol: string;
  timeframe: TimeFrame;
  timeRange: TimeRange;
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: TimeFrame) => void;
  onTimeRangeChange: (range: TimeRange) => void;
}

const TIMEFRAMES: TimeFrame[] = [
  '1m', '2m', '5m', '10m', '15m', '30m',
  '1h', '4h', 'D', 'W', 'M', '1Q', '1Y'
];

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '1D', value: '1D' },
  { label: '5D', value: '5D' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: 'YTD', value: 'YTD' },
  { label: '1Y', value: '1Y' },
  { label: '5Y', value: '5Y' },
  { label: 'MAX', value: 'MAX' },
];

export const Navbar: React.FC<NavbarProps> = ({
  symbol,
  timeframe,
  timeRange,
  onSymbolChange,
  onTimeframeChange,
  onTimeRangeChange,
}) => {
  const [searchValue, setSearchValue] = useState(symbol);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      onSymbolChange(searchValue.trim().toUpperCase());
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="brand-logo-container">
          <Logo size={36} />
          <div className="brand-text">
            <h1>U-TradeX</h1>
            <span className="brand-tagline">Professional Trading Platform</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSearch} className="symbol-search">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search symbol (e.g., AAPL)"
          className="search-input"
        />
        <button type="submit" className="search-btn">
          🔍
        </button>
      </form>

      <div className="timeframe-selector">
        <div className="selector-label">Timeframe:</div>
        <div className="timeframe-buttons">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              className={timeframe === tf ? 'active' : ''}
              onClick={() => onTimeframeChange(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="range-selector">
        <div className="selector-label">Range:</div>
        <div className="range-buttons">
          {TIME_RANGES.map((range) => (
            <button
              key={range.value}
              className={timeRange === range.value ? 'active' : ''}
              onClick={() => onTimeRangeChange(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
};
