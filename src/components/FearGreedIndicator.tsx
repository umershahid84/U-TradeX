import React, { useState } from 'react';
import { FearGreedData, MarketFearGreed } from '../types';
import './FearGreedIndicator.css';

interface FearGreedIndicatorProps {
  symbol: string;
  market: MarketFearGreed | null;
  marketError: string;
  ticker: FearGreedData | null;
}

const colorFor = (score: number) =>
  score < 25 ? '#ef5350' : score < 45 ? '#ff9800' : score < 55 ? '#ffc107' : score < 75 ? '#8bc34a' : '#26a69a';

const labelFor = (score: number) =>
  score < 25 ? 'EXTREME FEAR' : score < 45 ? 'FEAR' : score < 55 ? 'NEUTRAL' : score < 75 ? 'GREED' : 'EXTREME GREED';

const getSignalColor = (signal: FearGreedData['signal']) => {
  if (signal.includes('BUY')) return '#26a69a';
  if (signal.includes('SELL')) return '#ef5350';
  return '#ffc107';
};

const Gauge: React.FC<{ value: number }> = ({ value }) => (
  <div className="gauge-zones" title={`${value} / 100`}>
    <span className="zone z1" /><span className="zone z2" /><span className="zone z3" />
    <span className="zone z4" /><span className="zone z5" />
    <span className="gauge-pin" style={{ left: `${Math.max(0, Math.min(100, value))}%`, borderColor: colorFor(value) }} />
  </div>
);

export const FearGreedIndicator: React.FC<FearGreedIndicatorProps> = ({ symbol, market, marketError, ticker }) => {
  const [showParts, setShowParts] = useState(false);
  const score = market ? Math.round(market.score) : null;

  const history: [string, number | null][] = market
    ? [
        ['Previous close', market.previousClose],
        ['1 week ago', market.previousWeek],
        ['1 month ago', market.previousMonth],
        ['1 year ago', market.previousYear],
      ]
    : [];

  return (
    <div className="fear-greed-indicator">
      <div className="indicator-header">
        <h3>Fear & Greed Index</h3>
      </div>

      {/* Market-wide index */}
      <div className="fg-section-title">Stock market</div>
      {score === null ? (
        <div className="fg-empty">{marketError ? `Unavailable: ${marketError}` : 'Loading…'}</div>
      ) : (
        <>
          <Gauge value={market!.score} />
          <div className="gauge-value" style={{ color: colorFor(market!.score) }}>{score}</div>
          <div className="level-label" style={{ color: colorFor(market!.score) }}>{labelFor(market!.score)}</div>

          {market!.source === 'estimate' && (
            <div className="fg-estimate">
              CNN's index is unreachable right now, so this is an estimate from volatility, momentum, bonds and
              safe-haven demand. It can differ from CNN's number.
            </div>
          )}

          {history.some(([, v]) => v !== null) && (
            <div className="fg-history">
              {history.map(([label, v]) =>
                v === null ? null : (
                  <div key={label} className="fg-hist-row">
                    <span>{label}</span>
                    <span className="fg-hist-val" style={{ color: colorFor(v) }}>
                      {Math.round(v)} <small>{labelFor(v).toLowerCase()}</small>
                    </span>
                  </div>
                )
              )}
            </div>
          )}

          <button type="button" className="fg-toggle" onClick={() => setShowParts(!showParts)}>
            {showParts ? '▾' : '▸'} What makes up the score ({market!.components.length})
          </button>
          {showParts && (
            <div className="fg-parts">
              {market!.components.map((c) => (
                <div key={c.name} className="fg-part">
                  <span>{c.name}</span>
                  <span className="fg-bar"><i style={{ width: `${c.score}%`, background: colorFor(c.score) }} /></span>
                  <span className="fg-part-val" style={{ color: colorFor(c.score) }}>{Math.round(c.score)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="fg-source">
            {market!.source === 'cnn' ? 'Source: CNN Fear & Greed Index' : 'Source: estimate'} · updated{' '}
            {new Date(market!.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        </>
      )}

      {/* This symbol's own technical sentiment */}
      <div className="fg-divider" />
      <div className="fg-section-title">{symbol} technicals</div>
      {ticker === null ? (
        <div className="fg-empty">Not enough chart data (50+ bars needed). Try a shorter timeframe or longer range.</div>
      ) : (
        <div className="fg-ticker">
          <div className="fg-ticker-top">
            <span className="fg-ticker-value" style={{ color: colorFor(ticker.value) }}>{ticker.value}</span>
            <span className="fg-ticker-level" style={{ color: colorFor(ticker.value) }}>{ticker.level.toUpperCase()}</span>
            <span className="signal small" style={{ background: getSignalColor(ticker.signal) }}>{ticker.signal}</span>
          </div>
          <Gauge value={ticker.value} />
          <div className="market-conditions">
            {ticker.oversold && <div className="condition oversold"><span className="icon">📉</span><span>OVERSOLD</span></div>}
            {ticker.overbought && <div className="condition overbought"><span className="icon">📈</span><span>OVERBOUGHT</span></div>}
            {!ticker.oversold && !ticker.overbought && <div className="condition neutral"><span className="icon">➡️</span><span>NORMAL</span></div>}
          </div>
          <div className="fg-source">From RSI, trend, price vs 20-day average and volume on the current chart.</div>
        </div>
      )}
    </div>
  );
};
