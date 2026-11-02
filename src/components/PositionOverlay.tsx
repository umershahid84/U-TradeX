import React, { useEffect, useRef, useState } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { Position, TakeProfitStopLoss } from '../types';
import './PositionOverlay.css';

interface Props {
  chartRef: React.MutableRefObject<IChartApi | null>;
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  hostRef: React.RefObject<HTMLDivElement | null>;
  position?: Position;
  tpsl?: TakeProfitStopLoss;
  onSetLevel: (kind: 'takeProfit' | 'stopLoss', price?: number) => void;
  onClose: (quantity: number) => void;
  onReverse: () => void;
}

const money = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/**
 * TradingView-style position controls drawn on the chart next to the position's price lines:
 * a live P&L pill with close / half / reverse and add TP / SL, plus a close (✕) pill on the TP and SL lines.
 */
export const PositionOverlay: React.FC<Props> = ({ chartRef, seriesRef, hostRef, position, tpsl, onSetLevel, onClose, onReverse }) => {
  const [ys, setYs] = useState<{ entry?: number; tp?: number; sl?: number }>({});
  const last = useRef('');

  // Follow the price lines as the chart scrolls and rescales
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const series = seriesRef.current;
      const host = hostRef.current;
      const chart = chartRef.current;
      if (series && host && chart && position) {
        const paneH = chart.panes()[0]?.getHeight() ?? host.clientHeight;
        const y = (price?: number) => {
          if (!price) return undefined;
          try {
            const c = series.priceToCoordinate(price);
            return c === null || c < 8 || c > paneH - 8 ? undefined : Math.round(c as number) + host.offsetTop;
          } catch {
            return undefined;
          }
        };
        const next = { entry: y(position.avgPrice), tp: y(tpsl?.takeProfit), sl: y(tpsl?.stopLoss) };
        const key = `${next.entry}|${next.tp}|${next.sl}`;
        if (key !== last.current) {
          last.current = key;
          setYs(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chartRef, seriesRef, hostRef, position, tpsl?.takeProfit, tpsl?.stopLoss, position?.avgPrice]);

  if (!position) return null;
  const qty = Math.abs(position.quantity);
  const short = position.quantity < 0;
  const dir = short ? -1 : 1;
  const tpPnl = tpsl?.takeProfit ? (tpsl.takeProfit - position.avgPrice) * qty * dir : 0;
  const slPnl = tpsl?.stopLoss ? (tpsl.stopLoss - position.avgPrice) * qty * dir : 0;
  const up = position.pnl >= 0;
  // default distance for a freshly added level: 1% from the entry
  const levelAt = (kind: 'takeProfit' | 'stopLoss') => {
    const profitSide = kind === 'takeProfit' ? dir : -dir;
    return Math.round(position.avgPrice * (1 + 0.01 * profitSide) * 100) / 100;
  };

  return (
    <div className="pos-overlay">
      {ys.entry !== undefined && (
        <div className="pos-pill entry" style={{ top: ys.entry }}>
          <span className={`pos-side ${short ? 'short' : 'long'}`}>{short ? 'SHORT' : 'LONG'} {qty}</span>
          <span className={`pos-pnl ${up ? 'up' : 'down'}`}>
            {money(position.pnl)} ({position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%)
          </span>
          {!tpsl?.takeProfit && <button type="button" title="Add take profit" onClick={() => onSetLevel('takeProfit', levelAt('takeProfit'))}>+TP</button>}
          {!tpsl?.stopLoss && <button type="button" title="Add stop loss" onClick={() => onSetLevel('stopLoss', levelAt('stopLoss'))}>+SL</button>}
          {qty >= 2 && <button type="button" title="Close half" onClick={() => onClose(Math.floor(qty / 2))}>½</button>}
          <button type="button" title="Reverse position" onClick={onReverse}>⇄</button>
          <button type="button" className="close" title="Close position at market" onClick={() => onClose(qty)}>✕ Close</button>
        </div>
      )}
      {ys.tp !== undefined && tpsl?.takeProfit && (
        <div className="pos-pill tp" style={{ top: ys.tp }}>
          <span>TP {money(tpPnl)}</span>
          <button type="button" className="close" title="Cancel take profit" onClick={() => onSetLevel('takeProfit', undefined)}>✕</button>
        </div>
      )}
      {ys.sl !== undefined && tpsl?.stopLoss && (
        <div className="pos-pill sl" style={{ top: ys.sl }}>
          <span>SL {money(slPnl)}</span>
          <button type="button" className="close" title="Cancel stop loss" onClick={() => onSetLevel('stopLoss', undefined)}>✕</button>
        </div>
      )}
    </div>
  );
};
