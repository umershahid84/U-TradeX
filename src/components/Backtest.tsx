import React, { useMemo, useRef, useState } from 'react';
import { RealMarketDataService } from '../services/realMarketData';
import { BtParams, BtTrade, DEFAULT_BT, backtestSymbol, btStats } from '../utils/backtest';
import { NASDAQ_100, SP_500 } from '../utils/universes';
import './Backtest.css';

const SETS: { id: string; label: string; list: string[] }[] = [
  { id: 'top30', label: 'Top 30 Nasdaq-100', list: NASDAQ_100.slice(0, 30) },
  { id: 'ndx', label: 'Nasdaq-100 (all)', list: NASDAQ_100 },
  { id: 'sp100', label: 'First 100 of S&P 500', list: SP_500.slice(0, 100) },
];

const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '∞');

const Curve: React.FC<{ trades: BtTrade[] }> = ({ trades }) => {
  const pts = useMemo(() => {
    let e = 0;
    return [...trades].sort((a, b) => a.time - b.time).map((t) => (e += t.pnlPct));
  }, [trades]);
  if (pts.length < 2) return null;
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), W = 300, H = 90;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * (H - 6) - 3;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bt-curve" role="img" aria-label="Equity curve">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="#444" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={pts[pts.length - 1] >= 0 ? '#26a69a' : '#ef5350'} strokeWidth="1.6" />
    </svg>
  );
};

/** Replays the app's signals over the recent 5-minute history and reports what would have happened, with the opposite side as a control. */
export const Backtest: React.FC = () => {
  const [p, setP] = useState<BtParams>(DEFAULT_BT);
  const [setId, setSetId] = useState('top30');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [trades, setTrades] = useState<BtTrade[] | null>(null);
  const [failed, setFailed] = useState(0);
  const stop = useRef(false);
  const up = (patch: Partial<BtParams>) => setP((v) => ({ ...v, ...patch }));

  const run = async () => {
    const list = SETS.find((s) => s.id === setId)!.list;
    stop.current = false;
    setRunning(true); setTrades(null); setFailed(0); setProgress({ done: 0, total: list.length });
    const market = RealMarketDataService.getInstance();
    const all: BtTrade[] = [];
    let bad = 0, done = 0;
    const queue = [...list];
    const worker = async () => {
      while (queue.length && !stop.current) {
        const sym = queue.shift()!;
        try {
          const bars = await market.fetchChartData(sym, '5m', '3mo', false, true);
          all.push(...backtestSymbol(sym, bars, p));
        } catch { bad++; }
        setProgress({ done: ++done, total: list.length });
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setFailed(bad); setTrades(all); setRunning(false);
  };

  const st = trades ? btStats(trades) : null;
  const half = trades ? [...trades].sort((a, b) => a.time - b.time) : [];
  const first = btStats(half.slice(0, Math.floor(half.length / 2))), second = btStats(half.slice(Math.floor(half.length / 2)));
  const num = (k: keyof BtParams, label: string, step = 0.1) => (
    <label className="bt-f">{label}<input type="number" step={step} min={0} value={p[k] as number} onChange={(e) => up({ [k]: Math.max(0, +e.target.value) } as Partial<BtParams>)} /></label>
  );

  return (
    <div className="backtest">
      <div className="ag-head"><h3>Backtest</h3>
        {running ? <button className="ag-run on" onClick={() => { stop.current = true; }}>Stop</button> : <button className="ag-run" onClick={run}>Run</button>}
      </div>
      <div className="bt-form">
        <label className="bt-f">Signal
          <select value={p.signal} onChange={(e) => up({ signal: e.target.value as BtParams['signal'], stopAtr: 0, targetAtr: 0 })}>
            <option value="airgap">Air Gap entry</option><option value="curl">5/12 curl</option>
          </select></label>
        <label className="bt-f">Symbols
          <select value={setId} onChange={(e) => setSetId(e.target.value)}>{SETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="bt-f">Side
          <select value={p.side} onChange={(e) => up({ side: e.target.value as BtParams['side'] })}><option value="both">Long + short</option><option value="long">Long only</option><option value="short">Short only</option></select></label>
        {p.signal === 'airgap' && num('minRoomAtr', 'Min room (ATR)')}
        {num('stopAtr', p.signal === 'airgap' ? 'Stop ATR (0 = cloud edge)' : 'Stop ATR (0 = 1)')}
        {num('targetAtr', p.signal === 'airgap' ? 'Target ATR (0 = next cloud)' : 'Target ATR (0 = 1.5)')}
        {num('costPct', 'Cost per trade (%)', 0.01)}
        {p.signal === 'airgap' && <label className="bt-chk"><input type="checkbox" checked={p.withTrendOnly} onChange={(e) => up({ withTrendOnly: e.target.checked })} /> With-trend only</label>}
      </div>
      {running && <div className="bt-prog">Testing {progress.done} / {progress.total} symbols…</div>}
      {st && (
        <>
          {st.n === 0 ? <p className="bt-note">No signals in this history with these settings.</p> : (
            <>
              <div className="bt-grid">
                <div><b>{st.n}</b><span>trades</span></div>
                <div><b>{f(st.winPct, 0)}%</b><span>profitable</span></div>
                <div className={st.avgPct >= 0 ? 'pos' : 'neg'}><b>{f(st.avgPct, 3)}%</b><span>avg / trade, after costs</span></div>
                <div className={st.totalPct >= 0 ? 'pos' : 'neg'}><b>{f(st.totalPct, 1)}%</b><span>sum of trades</span></div>
                <div><b>{f(st.profitFactor)}</b><span>profit factor</span></div>
                <div><b>{f(st.maxDdPct, 1)}%</b><span>max drawdown</span></div>
                <div><b>{f(st.targetPct, 0)} / {f(st.stopPct, 0)} / {f(st.eodPct, 0)}%</b><span>target / stop / day-end</span></div>
                <div><b>{f(st.avgAtr, 2)} ATR</b><span>avg gross</span></div>
              </div>
              <Curve trades={trades!} />
              <table className="bt-tbl"><tbody>
                <tr><th></th><th>Trades</th><th>Avg %</th></tr>
                <tr><td>Signal side</td><td>{st.n}</td><td>{f(st.avgPct, 3)}</td></tr>
                <tr><td>Opposite side, same stop/target (control)</td><td>{st.n}</td><td>{f(st.mirrorAvgPct, 3)}</td></tr>
                <tr><td>First half of the period</td><td>{first.n}</td><td>{f(first.avgPct, 3)}</td></tr>
                <tr><td>Second half</td><td>{second.n}</td><td>{f(second.avgPct, 3)}</td></tr>
              </tbody></table>
              <details><summary>Recent trades</summary>
                <table className="bt-tbl"><tbody>
                  {[...trades!].sort((a, b) => b.time - a.time).slice(0, 40).map((t, i) => (
                    <tr key={i}><td>{t.symbol}</td><td>{t.side}</td><td>{new Date(t.time * (t.time < 1e12 ? 1000 : 1)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>{t.out}</td><td className={t.pnlPct >= 0 ? 'pos' : 'neg'}>{f(t.pnlPct, 2)}%</td></tr>
                  ))}
                </tbody></table></details>
            </>
          )}
          {failed > 0 && <p className="bt-note">{failed} symbols could not be loaded.</p>}
        </>
      )}
      <p className="bt-note">Replays the signals on about 3 months (~59 trading days) of Yahoo 5-minute candles, regular hours, entries 9:45–15:15 ET, exits at stop, target or the day's close (stop first when one candle touches both). Costs are a flat percent per trade. The settings are not tuned on this data, but it is a short, single-regime sample: a good result here is not evidence of an edge, and a past result guarantees nothing. If the control side does about as well as the signal, the signal adds nothing.</p>
    </div>
  );
};
