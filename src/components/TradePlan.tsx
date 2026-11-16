import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IChartApi, ISeriesApi, IPriceLine } from 'lightweight-charts';
import { Order } from '../types';
import { PlanSide, atr as atrOf, defaultPlan, planResult } from '../utils/tradePlan';
import { ChartData } from '../types';
import './TradePlan.css';

type Level = 'entry' | 'stop' | 'target';

interface Props {
  chartRef: React.MutableRefObject<IChartApi | null>;
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  hostRef: React.RefObject<HTMLDivElement | null>;
  symbol: string;
  currentPrice: number;
  bars: ChartData[];
  equity: number;
  balance: number;
  onPlace: (order: Omit<Order, 'id' | 'status' | 'timestamp'>, takeProfit?: number, stopLoss?: number) => void;
  onClose: () => void;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const money = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const COLORS: Record<Level, string> = { entry: '#4C9AFF', stop: '#ef5350', target: '#26a69a' };

/**
 * Trade plan: draw entry, stop and target on the chart (drag the lines), see the risk and reward, and the size
 * that risks a chosen percent of the account. Placing it sends a paper order with the stop and target attached.
 */
export const TradePlan: React.FC<Props> = ({ chartRef, seriesRef, hostRef, symbol, currentPrice, bars, equity, balance, onPlace, onClose }) => {
  const atrValue = useMemo(() => atrOf(bars, 14), [bars]);
  const [side, setSide] = useState<PlanSide>('long');
  const [riskPct, setRiskPct] = useState(() => {
    try {
      return Number(localStorage.getItem('planRiskPct')) || 1;
    } catch {
      return 1;
    }
  });
  const [lv, setLv] = useState(() => ({ entry: r2(currentPrice), ...defaultPlan('long', currentPrice, atrValue) }));
  const [ys, setYs] = useState<Partial<Record<Level, number>>>({});
  const [dragging, setDragging] = useState<Level | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const lines = useRef<Partial<Record<Level, IPriceLine>>>({});
  const last = useRef('');

  const result = planResult({ side, entry: lv.entry, stop: lv.stop, target: lv.target, riskPct, equity, balance });

  const changeSide = (next: PlanSide) => {
    setSide(next);
    setLv((cur) => ({ entry: cur.entry, ...defaultPlan(next, cur.entry, atrValue) }));
  };
  const setLevel = (k: Level, v: number) => setLv((cur) => ({ ...cur, [k]: r2(v) }));

  useEffect(() => {
    try {
      localStorage.setItem('planRiskPct', String(riskPct));
    } catch {
      /* storage unavailable */
    }
  }, [riskPct]);

  // price lines on the chart
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const drop = () => {
      for (const l of Object.values(lines.current)) {
        try {
          if (l) series.removePriceLine(l);
        } catch {
          /* series was replaced */
        }
      }
      lines.current = {};
    };
    drop();
    const make = (k: Level, price: number, title: string) => {
      if (price > 0) lines.current[k] = series.createPriceLine({ price, color: COLORS[k], lineWidth: k === 'entry' ? 1 : 2, lineStyle: k === 'entry' ? 2 : 0, axisLabelVisible: true, title });
    };
    make('entry', lv.entry, `${side === 'long' ? 'LONG' : 'SHORT'} entry`);
    make('stop', lv.stop, result.valid ? `STOP -${money(result.riskAmount)}` : 'STOP');
    make('target', lv.target, result.valid ? `TARGET +${money(result.rewardAmount)}` : 'TARGET');
    return drop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lv.entry, lv.stop, lv.target, side, result.valid, result.riskAmount, result.rewardAmount, symbol]);

  // keep the drag handles next to their lines
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const series = seriesRef.current, host = hostRef.current, chart = chartRef.current;
      if (series && host && chart) {
        const paneH = chart.panes()[0]?.getHeight() ?? host.clientHeight;
        const y = (price: number) => {
          try {
            const c = series.priceToCoordinate(price);
            return c === null || c < 8 || c > paneH - 8 ? undefined : Math.round(c as number) + host.offsetTop;
          } catch {
            return undefined;
          }
        };
        const next = { entry: y(lv.entry), stop: y(lv.stop), target: y(lv.target) };
        const key = `${next.entry}|${next.stop}|${next.target}`;
        if (key !== last.current) {
          last.current = key;
          setYs(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chartRef, seriesRef, hostRef, lv.entry, lv.stop, lv.target]);

  const startDrag = (k: Level) => (e: React.PointerEvent) => {
    const host = hostRef.current, series = seriesRef.current;
    if (!host || !series) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setDragging(k);
    const move = (ev: PointerEvent) => {
      const top = host.getBoundingClientRect().top;
      const h = chartRef.current?.panes()[0]?.getHeight() ?? host.clientHeight;
      const price = series.coordinateToPrice(Math.max(0, Math.min(h - 1, ev.clientY - top)));
      if (price !== null && (price as number) > 0) setLevel(k, price as number);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const place = () => {
    if (!result.valid) return;
    const long = side === 'long';
    // an entry below (long) / above (short) the price waits as a limit order; otherwise it fills at the market
    const waits = long ? lv.entry < currentPrice * 0.9995 : lv.entry > currentPrice * 1.0005;
    onPlace(
      { symbol, type: waits ? 'limit' : 'market', side: long ? 'buy' : 'sell', quantity: result.qty, price: waits ? lv.entry : currentPrice },
      lv.target,
      lv.stop
    );
    onClose();
  };

  const num = (k: Level) => (
    <input
      type="number"
      step="0.01"
      value={lv[k]}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) setLevel(k, v);
      }}
      aria-label={`${k} price`}
    />
  );
  const waits = side === 'long' ? lv.entry < currentPrice * 0.9995 : lv.entry > currentPrice * 1.0005;

  return (
    <>
      <div className="plan-overlay">
        {(['target', 'entry', 'stop'] as Level[]).map(
          (k) =>
            ys[k] !== undefined && (
              <div key={k} className={`plan-pill ${k} ${dragging === k ? 'dragging' : ''}`} style={{ top: ys[k] }} onPointerDown={startDrag(k)} title="Drag up or down">
                ⋮⋮ {k === 'entry' ? 'ENTRY' : k === 'stop' ? 'STOP' : 'TARGET'}
                {result.valid && k !== 'entry' && <b>{k === 'stop' ? `-${money(result.riskAmount)}` : `+${money(result.rewardAmount)}`}</b>}
              </div>
            )
        )}
      </div>
      <div className="plan-card" role="dialog" aria-label="Trade plan">
        <div className="plan-head">
          <strong>📐 Trade plan · {symbol}</strong>
          <span>
            <button type="button" onClick={() => setCollapsed((v) => !v)} aria-label="Collapse">{collapsed ? '▴' : '▾'}</button>
            <button type="button" onClick={onClose} aria-label="Close plan">✕</button>
          </span>
        </div>
        {!collapsed && (
          <>
            <div className="plan-side">
              <button type="button" className={side === 'long' ? 'on long' : ''} onClick={() => changeSide('long')}>Long</button>
              <button type="button" className={side === 'short' ? 'on short' : ''} onClick={() => changeSide('short')}>Short</button>
            </div>
            <div className="plan-grid">
              <label>Entry {num('entry')}</label>
              <label>Stop {num('stop')}</label>
              <label>Target {num('target')}</label>
              <label>
                Risk % of account
                <input type="number" min="0.1" max="10" step="0.1" value={riskPct} onChange={(e) => setRiskPct(Math.max(0.1, Math.min(10, parseFloat(e.target.value) || 1)))} aria-label="Risk percent" />
              </label>
            </div>
            <div className="plan-actions">
              <button type="button" onClick={() => setLv({ entry: r2(currentPrice), ...defaultPlan(side, currentPrice, atrValue) })}>
                Reset at price{atrValue ? ' (1.5 ATR stop, 2R target)' : ''}
              </button>
            </div>
            {result.valid ? (
              <div className="plan-result">
                <div><span>Size</span><b>{result.qty} shares · {money(result.cost)}</b></div>
                <div><span>Risk</span><b className="down">-{money(result.riskAmount)}</b></div>
                <div><span>Reward</span><b className="up">+{money(result.rewardAmount)}</b></div>
                <div><span>Reward : risk</span><b>{result.rr.toFixed(2)} R</b></div>
                {result.cappedByCash && <div className="plan-note">Size reduced to fit your cash.</div>}
                <div className="plan-note">{waits ? `Entry is ${side === 'long' ? 'below' : 'above'} the price: placed as a limit order that fills when reached.` : 'Entry is at the price: placed as a market order.'}</div>
              </div>
            ) : (
              <div className="plan-problem">{result.problem}</div>
            )}
            <button type="button" className={`plan-place ${side}`} disabled={!result.valid} onClick={place}>
              Place paper {side === 'long' ? 'buy' : 'sell'} with stop and target
            </button>
            <div className="plan-note">Paper trading only. The stop and target close the position automatically when hit.</div>
          </>
        )}
      </div>
    </>
  );
};
