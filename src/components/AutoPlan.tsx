import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IChartApi, ISeriesApi, IPriceLine } from 'lightweight-charts';
import { ChartData, Order } from '../types';
import { AutoPlan as Plan, buildPlan } from '../utils/autoPlan';
import { planResult } from '../utils/tradePlan';
import { PriceBandPrimitive } from '../plugins/priceBand';
import './AutoPlan.css';

type Layer = 'lines' | 'checks' | 'elevator';

interface Props {
  chartRef: React.MutableRefObject<IChartApi | null>;
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  hostRef: React.RefObject<HTMLDivElement | null>;
  symbol: string;
  timeframe: string;
  bars: ChartData[];
  equity: number;
  balance: number;
  onPlace: (order: Omit<Order, 'id' | 'status' | 'timestamp'>, takeProfit?: number, stopLoss?: number) => void;
  onClose: () => void;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const PHASE_LABEL: Record<Plan['phase'], string> = {
  watching: 'WATCHING',
  entry: 'ENTRY',
  in_trade: 'IN TRADE',
  target1: 'TARGET 1',
  target2: 'TARGET 2',
  stopped: 'STOPPED',
};
const COLOR = { entry: '#4C9AFF', stop: '#ef5350', cheat: '#ffa726', t1: '#26a69a', t2: '#1de9b6' };
const PRESETS: Record<string, Record<Layer, boolean>> = {
  clean: { lines: true, checks: false, elevator: false },
  air: { lines: true, checks: false, elevator: true },
  full: { lines: true, checks: true, elevator: true },
};

const loadLayers = (): Record<Layer, boolean> => {
  try {
    const saved = JSON.parse(localStorage.getItem('autoPlanLayers') ?? 'null');
    if (saved && typeof saved.lines === 'boolean') return { ...PRESETS.full, ...saved };
  } catch {
    /* defaults */
  }
  return PRESETS.full;
};

/**
 * Auto plan: the chart's own plan drawn on it: entry, stop, cheat exit and two targets from the 5/12 and 34/50
 * EMA clouds, seven live checks, and an "elevator" of every level in price order with the air gap between the
 * clouds. Layers can be switched on and off. Placing it sends a paper order with the stop and cheat exit attached.
 */
export const AutoPlan: React.FC<Props> = ({ chartRef, seriesRef, hostRef, symbol, timeframe, bars, equity, balance, onPlace, onClose }) => {
  const plan = useMemo(() => buildPlan(bars), [bars]);
  const [layers, setLayers] = useState<Record<Layer, boolean>>(loadLayers);
  const [collapsed, setCollapsed] = useState(false);
  const [riskPct, setRiskPct] = useState(() => {
    try {
      return Number(localStorage.getItem('planRiskPct')) || 1;
    } catch {
      return 1;
    }
  });
  const [ys, setYs] = useState<Record<string, number | undefined>>({});
  const lines = useRef<IPriceLine[]>([]);
  const band = useRef<PriceBandPrimitive | null>(null);
  const last = useRef('');

  useEffect(() => {
    try {
      localStorage.setItem('autoPlanLayers', JSON.stringify(layers));
    } catch {
      /* storage unavailable */
    }
  }, [layers]);

  const preset = (name: keyof typeof PRESETS) => setLayers(PRESETS[name]);
  const activePreset = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((k) => (Object.keys(PRESETS[k]) as Layer[]).every((l) => PRESETS[k][l] === layers[l]));

  // the plan's lines on the chart
  const key = plan ? `${plan.side}|${plan.phase}|${plan.entry}|${plan.stop}|${plan.cheat}|${plan.t1}|${plan.t2}` : '';
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const drop = () => {
      for (const l of lines.current) {
        try {
          series.removePriceLine(l);
        } catch {
          /* series replaced */
        }
      }
      lines.current = [];
    };
    drop();
    if (!plan || !layers.lines) return drop;
    const faint = plan.phase === 'watching' ? ' (if triggered)' : '';
    const mk = (price: number, color: string, _title: string, dashed = false) =>
      lines.current.push(series.createPriceLine({ price, color, lineWidth: dashed ? 1 : 2, lineStyle: dashed ? 2 : 0, axisLabelVisible: true, title: '' }));
    mk(plan.entry, COLOR.entry, `ENTRY${faint}`);
    mk(plan.stop, COLOR.stop, 'STOP');
    mk(plan.cheat, COLOR.cheat, 'CHEAT EXIT', true);
    mk(plan.t1, COLOR.t1, 'TARGET 1');
    mk(plan.t2, COLOR.t2, 'TARGET 2', true);
    return drop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, layers.lines, symbol]);

  // the air gap band
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!band.current) {
      band.current = new PriceBandPrimitive();
      series.attachPrimitive(band.current);
    }
    band.current.setBand(plan && plan.airGap && layers.elevator ? { from: plan.airGap.from, to: plan.airGap.to, label: `AIR GAP ${money(plan.airGap.amount)}` } : null);
  }, [plan?.airGap?.from, plan?.airGap?.to, layers.elevator, seriesRef]);
  useEffect(
    () => () => {
      const series = seriesRef.current;
      if (series && band.current) {
        try {
          band.current.setBand(null);
          series.detachPrimitive(band.current);
        } catch {
          /* series replaced */
        }
      }
      band.current = null;
    },
    [seriesRef]
  );

  // labels next to the lines
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const series = seriesRef.current, host = hostRef.current, chart = chartRef.current;
      if (series && host && chart && plan && layers.lines) {
        const paneH = chart.panes()[0]?.getHeight() ?? host.clientHeight;
        const y = (price: number) => {
          try {
            const c = series.priceToCoordinate(price);
            return c === null || c < 8 || c > paneH - 8 ? undefined : Math.round(c as number) + host.offsetTop;
          } catch {
            return undefined;
          }
        };
        const next = { entry: y(plan.entry), stop: y(plan.stop), cheat: y(plan.cheat), t1: y(plan.t1), t2: y(plan.t2) };
        const k = JSON.stringify(next);
        if (k !== last.current) {
          last.current = k;
          setYs(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chartRef, seriesRef, hostRef, plan, layers.lines]);

  if (!plan) {
    return (
      <div className="ap-card" role="dialog" aria-label="Auto plan">
        <div className="ap-head">
          <strong>🧭 Auto plan · {symbol}</strong>
          <button type="button" onClick={onClose} aria-label="Close auto plan">✕</button>
        </div>
        <div className="ap-note">Needs about 60 candles including today's regular session to build the 5/12 and 34/50 clouds. Try the 5, 10 or 15 minute chart.</div>
      </div>
    );
  }

  const long = plan.side === 'long';
  const triggered = plan.phase !== 'watching';
  // size on the real entry: the price now once triggered, with the stop and the cheat exit
  const sizing = planResult({
    side: plan.side,
    entry: triggered ? plan.price : plan.entry,
    stop: plan.stop,
    target: plan.cheat,
    riskPct,
    equity,
    balance,
  });
  const place = () => {
    if (!sizing.valid || !triggered) return;
    onPlace({ symbol, type: 'market', side: long ? 'buy' : 'sell', quantity: sizing.qty, price: plan.price }, plan.cheat, plan.stop);
    onClose();
  };
  const pill = (k: 'entry' | 'stop' | 'cheat' | 't1' | 't2', label: string, price: number) =>
    ys[k] !== undefined && (
      <div key={k} className={`ap-pill ${k}`} style={{ top: ys[k] }}>
        {label} <b>{money(price)}</b>
        {k !== 'entry' && <i>{`${price >= plan.entry ? '+' : '-'}${money(Math.abs(price - plan.entry))}`}</i>}
      </div>
    );
  const gaps = plan.levels.map((l, i) => (i < plan.levels.length - 1 ? l.price - plan.levels[i + 1].price : 0));

  return (
    <>
      {layers.lines && (
        <div className="ap-overlay">
          {pill('t2', 'T2', plan.t2)}
          {pill('t1', 'T1', plan.t1)}
          {pill('cheat', 'CHEAT', plan.cheat)}
          {pill('entry', plan.phase === 'watching' ? 'ENTRY IF' : 'ENTRY', plan.entry)}
          {pill('stop', 'STOP', plan.stop)}
        </div>
      )}
      <div className="ap-card" role="dialog" aria-label="Auto plan">
        <div className="ap-head">
          <strong>🧭 Auto plan · {symbol} · {timeframe}</strong>
          <span>
            <button type="button" onClick={() => setCollapsed((v) => !v)} aria-label="Collapse">{collapsed ? '▴' : '▾'}</button>
            <button type="button" onClick={onClose} aria-label="Close auto plan">✕</button>
          </span>
        </div>
        {!collapsed && (
          <>
            <div className={`ap-phase ${long ? 'long' : 'short'} ${plan.phase}`}>
              <b>{long ? '▲ BULLISH PLAN' : '▼ BEARISH PLAN'}</b>
              <span>{PHASE_LABEL[plan.phase]}</span>
            </div>
            <div className="ap-msg">{plan.message}</div>

            <div className="ap-views">
              <button type="button" className={activePreset === 'clean' ? 'on' : ''} onClick={() => preset('clean')}>Clean</button>
              <button type="button" className={activePreset === 'air' ? 'on' : ''} onClick={() => preset('air')}>Air gap</button>
              <button type="button" className={activePreset === 'full' ? 'on' : ''} onClick={() => preset('full')}>Full</button>
            </div>

            <table className="ap-levels">
              <tbody>
                <tr><td>Entry</td><td>{money(plan.entry)}</td></tr>
                <tr><td>Stop</td><td className="down">{money(plan.stop)} <small>-{money(plan.risk)}</small></td></tr>
                <tr><td>Cheat exit</td><td>{money(plan.cheat)}</td></tr>
                <tr><td>Target 1</td><td className="up">{money(plan.t1)} <small>{plan.rr.toFixed(2)} R</small></td></tr>
                <tr><td>Target 2</td><td className="up">{money(plan.t2)}</td></tr>
              </tbody>
            </table>

            {layers.checks && (
              <div className="ap-section">
                <div className="ap-sec-head">
                  <span>Rule checks</span>
                  <b className={plan.checkCount >= 5 ? 'up' : plan.checkCount >= 3 ? 'mid' : 'down'}>{plan.checkCount} / 7</b>
                </div>
                {plan.checks.map((c) => (
                  <div key={c.id} className={`ap-check ${c.ok ? 'ok' : 'no'}`}>
                    <span>{c.ok ? '✓' : '✗'}</span>
                    <em>{c.label}</em>
                    <small>{c.value}</small>
                  </div>
                ))}
              </div>
            )}

            {layers.elevator && (
              <div className="ap-section">
                <div className="ap-sec-head"><span>Elevator</span><small>{plan.airGap ? `air gap ${money(plan.airGap.amount)}` : 'clouds overlap'}</small></div>
                <div className="ap-elevator">
                  {(() => {
                    const rows: React.ReactNode[] = [];
                    let placed = false;
                    plan.levels.forEach((l, i) => {
                      if (!placed && plan.price >= l.price) {
                        rows.push(<div key="price" className="ap-lv price"><span>▸ Price</span><b>{money(plan.price)}</b></div>);
                        placed = true;
                      }
                      const inGap = plan.airGap && l.price <= plan.airGap.to + 1e-6 && l.price >= plan.airGap.from - 1e-6;
                      rows.push(
                        <div key={`${l.label}-${i}`} className={`ap-lv ${l.kind} ${inGap ? 'gap' : ''}`}>
                          <span>{l.label}</span>
                          <b>{money(l.price)}</b>
                          {i < plan.levels.length - 1 && gaps[i] > 0.004 && <i>↕ {money(gaps[i])}</i>}
                        </div>
                      );
                    });
                    if (!placed) rows.push(<div key="price" className="ap-lv price"><span>▸ Price</span><b>{money(plan.price)}</b></div>);
                    return rows;
                  })()}
                </div>
              </div>
            )}

            <div className="ap-layers">
              {(['lines', 'checks', 'elevator'] as Layer[]).map((l) => (
                <label key={l}>
                  <input type="checkbox" checked={layers[l]} onChange={() => setLayers((cur) => ({ ...cur, [l]: !cur[l] }))} />
                  {l === 'lines' ? 'Plan lines' : l === 'checks' ? 'Checks' : 'Elevator + air gap'}
                </label>
              ))}
            </div>

            <div className="ap-risk">
              <label>
                Risk %
                <input type="number" min="0.1" max="10" step="0.1" value={riskPct} onChange={(e) => setRiskPct(Math.max(0.1, Math.min(10, parseFloat(e.target.value) || 1)))} aria-label="Risk percent" />
              </label>
              <span>{sizing.valid ? `${sizing.qty} shares · risk ${money(sizing.riskAmount)}` : sizing.problem}</span>
            </div>
            <button type="button" className={`ap-place ${long ? 'long' : 'short'}`} disabled={!triggered || !sizing.valid} onClick={place}>
              {triggered ? `Place paper ${long ? 'buy' : 'sell'} with stop and cheat exit` : 'Place once the trigger prints'}
            </button>
            <div className="ap-note">
              A rule-based reading of the 5/12 and 34/50 EMA clouds (of the high-low midpoint). It is not a prediction or advice. Paper trading only.
            </div>
          </>
        )}
      </div>
    </>
  );
};
