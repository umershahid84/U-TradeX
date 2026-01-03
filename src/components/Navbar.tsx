import React, { useState } from 'react';
import { TimeFrame, TimeRange } from '../types';
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
  '1m', '2m', '3m', '5m', '10m', '15m', '30m',
  '1h', '4h', '1d', '1w', '1M', '3M', '1y'
];

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: 'Today', value: 'today' },
  { label: '1D', value: '1d' },
  { label: '5D', value: '5d' },
  { label: '1W', value: '1w' },
  { label: '1Y', value: '1y' },
  { label: 'Max', value: 'max' },
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
        <h1>U-TradeX</h1>
        <span className="brand-tagline">Professional Trading Platform</span>
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
