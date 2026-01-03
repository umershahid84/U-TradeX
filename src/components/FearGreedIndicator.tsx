import React from 'react';
import { FearGreedData } from '../types';
import './FearGreedIndicator.css';

interface FearGreedIndicatorProps {
  data: FearGreedData;
}

export const FearGreedIndicator: React.FC<FearGreedIndicatorProps> = ({ data }) => {
  const getColor = (level: FearGreedData['level']) => {
    switch (level) {
      case 'extreme fear':
        return '#ef5350';
      case 'fear':
        return '#ff9800';
      case 'neutral':
        return '#ffc107';
      case 'greed':
        return '#8bc34a';
      case 'extreme greed':
        return '#26a69a';
    }
  };

  const getSignalColor = (signal: FearGreedData['signal']) => {
    if (signal.includes('BUY')) return '#26a69a';
    if (signal.includes('SELL')) return '#ef5350';
    return '#ffc107';
  };

  return (
    <div className="fear-greed-indicator">
      <div className="indicator-header">
        <h3>Fear & Greed Index</h3>
      </div>
      
      <div className="gauge-container">
        <div className="gauge">
          <div
            className="gauge-fill"
            style={{
              width: `${data.value}%`,
              background: getColor(data.level),
            }}
          />
        </div>
        <div className="gauge-value" style={{ color: getColor(data.level) }}>
          {data.value}
        </div>
      </div>

      <div className="level-label" style={{ color: getColor(data.level) }}>
        {data.level.toUpperCase()}
      </div>

      <div className="signal-container">
        <div className="signal" style={{ background: getSignalColor(data.signal) }}>
          {data.signal}
        </div>
      </div>

      <div className="market-conditions">
        {data.oversold && (
          <div className="condition oversold">
            <span className="icon">📉</span>
            <span>OVERSOLD</span>
          </div>
        )}
        {data.overbought && (
          <div className="condition overbought">
            <span className="icon">📈</span>
            <span>OVERBOUGHT</span>
          </div>
        )}
        {!data.oversold && !data.overbought && (
          <div className="condition neutral">
            <span className="icon">➡️</span>
            <span>NORMAL</span>
          </div>
        )}
      </div>
    </div>
  );
};
