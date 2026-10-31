import React, { useState } from 'react';
import { PriceAlert } from '../types';
import './AlertsPanel.css';

interface AlertsPanelProps {
  symbol: string;
  currentPrice: number;
  alerts: PriceAlert[];
  armed: boolean;
  onAdd: (price: number) => void;
  onArm: () => void;
  onRemove: (id: string) => void;
  onClearTriggered: () => void;
  onSelectSymbol: (symbol: string) => void;
}

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const AlertsPanel: React.FC<AlertsPanelProps> = ({
  symbol, currentPrice, alerts, armed, onAdd, onArm, onRemove, onClearTriggered, onSelectSymbol,
}) => {
  const [value, setValue] = useState('');
  const price = parseFloat(value);
  const valid = Number.isFinite(price) && price > 0;

  const active = alerts.filter((a) => !a.triggeredAt);
  const fired = alerts.filter((a) => a.triggeredAt).sort((a, b) => (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0));
  const mine = active.filter((a) => a.symbol.toUpperCase() === symbol.toUpperCase());
  const others = active.filter((a) => a.symbol.toUpperCase() !== symbol.toUpperCase());

  const row = (a: PriceAlert, showSymbol: boolean) => (
    <div key={a.id} className="alert-row">
      <span className={`alert-dir ${a.direction}`}>{a.direction === 'above' ? '▲' : '▼'}</span>
      {showSymbol && (
        <button type="button" className="alert-sym" onClick={() => onSelectSymbol(a.symbol)}>{a.symbol}</button>
      )}
      <span className="alert-price">${fmt(a.price)}</span>
      <span className="alert-note">
        {a.direction === 'above' ? 'rises to' : 'falls to'}
        {currentPrice > 0 && !showSymbol && (
          <em> ({((a.price / currentPrice - 1) * 100).toFixed(1)}% away)</em>
        )}
      </span>
      <button type="button" className="alert-x" onClick={() => onRemove(a.id)} aria-label="Delete alert">✕</button>
    </div>
  );

  return (
    <div className="alerts-panel">
      <div className="alerts-head">
        <h3>Price Alerts</h3>
        <span className="alerts-cur">{symbol} ${fmt(currentPrice)}</span>
      </div>

      <form
        className="alerts-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) { onAdd(price); setValue(''); }
        }}
      >
        <input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Alert price for ${symbol}`}
          aria-label="Alert price"
        />
        <button type="submit" disabled={!valid}>Add</button>
      </form>
      <button type="button" className={`alerts-click ${armed ? 'armed' : ''}`} onClick={onArm}>
        {armed ? 'Click the chart to place it… (Esc to cancel)' : '🎯 Or click on the chart to place an alert'}
      </button>

      <div className="alerts-section">{symbol} alerts ({mine.length})</div>
      {mine.length === 0 ? <div className="alerts-empty">None yet for {symbol}.</div> : mine.map((a) => row(a, false))}

      {others.length > 0 && (
        <>
          <div className="alerts-section">Other symbols ({others.length})</div>
          {others.map((a) => row(a, true))}
        </>
      )}

      {fired.length > 0 && (
        <>
          <div className="alerts-section">
            Triggered
            <button type="button" className="alerts-clear" onClick={onClearTriggered}>Clear</button>
          </div>
          {fired.slice(0, 6).map((a) => (
            <div key={a.id} className="alert-row fired">
              <span className="alert-dir">✓</span>
              <button type="button" className="alert-sym" onClick={() => onSelectSymbol(a.symbol)}>{a.symbol}</button>
              <span className="alert-price">${fmt(a.price)}</span>
              <span className="alert-note">
                {new Date(a.triggeredAt!).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="alerts-foot">
        Alerts are checked while this page is open. Prices come from the same feed as the chart.
      </div>
    </div>
  );
};
