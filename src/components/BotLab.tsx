import React, { useState } from 'react';
import { RealMarketDataService } from '../services/realMarketData';
import { OrbBotConfig, DEFAULT_BOT } from '../hooks/useOrbBot';
import { runOrb, OrbResult } from '../utils/orb';
import './BotLab.css';

interface Props {
  activeSymbol: string;
  config: OrbBotConfig;
  setConfig: React.Dispatch<React.SetStateAction<OrbBotConfig>>;
  status: string;
  equity: number;
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const Sparkline: React.FC<{ points: { value: number }[] }> = ({ points }) => {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const path = vals.map((v, i) => `${(i / (vals.length - 1)) * 300},${46 - ((v - lo) / span) * 42}`).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg viewBox="0 0 300 50" className="bot-spark" role="img" aria-label="Equity curve">
      <polyline points={path} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="2" />
    </svg>
  );
};

/** Bots: a rule-based opening-range-breakout strategy you can backtest, watch live, and let trade the paper account */
export const BotLab: React.FC<Props> = ({ activeSymbol, config, setConfig, status, equity }) => {
  const [result, setResult] = useState<OrbResult | null>(null);
  const [ran, setRan] = useState<{ symbol: string; days: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof OrbBotConfig>(k: K, v: OrbBotConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));

  const backtest = async () => {
    setBusy(true);
    setError('');
    try {
      const bars = await RealMarketDataService.getInstance().fetchChartData(config.symbol, '5m', '3mo', false);
      const res = runOrb(bars, { orMinutes: config.orMinutes, targetR: config.targetR, riskPct: config.riskPct, longs: config.longs, shorts: config.shorts, startEquity: 100_000 });
      setResult(res);
      setRan({ symbol: config.symbol, days: res.stats.days });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const s = result?.stats;
  return (
    <div className="botlab">
      <h3>Bots <small>paper account only</small></h3>

      <div className="bot-card">
        <div className="bot-title">Opening-range breakout</div>
        <p className="bot-desc">
          The first minutes of the session set a high and a low. The first 5-minute close beyond it is the signal. Enter next bar, stop at the other
          side of the range, target a multiple of the risk, sold at the close if still open. One trade a day.
        </p>

        <div className="bot-grid">
          <label>
            Symbol
            <span className="bot-sym">
              <input value={config.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase().trim())} aria-label="Bot symbol" />
              <button type="button" onClick={() => set('symbol', activeSymbol)} title="Use the charted symbol">chart</button>
            </span>
          </label>
          <label>
            Range
            <select value={config.orMinutes} onChange={(e) => set('orMinutes', Number(e.target.value))} aria-label="Opening range minutes">
              {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <label>
            Target (R)
            <input type="number" min="0.5" max="6" step="0.5" value={config.targetR} onChange={(e) => set('targetR', Math.max(0.5, Math.min(6, parseFloat(e.target.value) || 2)))} aria-label="Target in R" />
          </label>
          <label>
            Risk % / trade
            <input type="number" min="0.1" max="5" step="0.1" value={config.riskPct} onChange={(e) => set('riskPct', Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 1)))} aria-label="Risk percent" />
          </label>
        </div>
        <div className="bot-checks">
          <label><input type="checkbox" checked={config.longs} onChange={(e) => set('longs', e.target.checked)} /> Longs</label>
          <label><input type="checkbox" checked={config.shorts} onChange={(e) => set('shorts', e.target.checked)} /> Shorts</label>
        </div>

        <button type="button" className="bot-run" onClick={backtest} disabled={busy || !config.symbol}>
          {busy ? 'Running…' : `Backtest ${config.symbol}`}
        </button>
        {error && <div className="bot-error">{error}</div>}

        {s && ran && (
          <div className="bot-results">
            <div className="bot-head">{ran.symbol} · {ran.days} sessions of 5-minute bars · $100,000 start</div>
            {s.trades === 0 ? (
              <div className="bot-empty">No trades: the rules never triggered in this history.</div>
            ) : (
              <>
                <div className="bot-stats">
                  <div><span>Trades</span><b>{s.trades}</b></div>
                  <div><span>Win rate</span><b>{(s.winRate * 100).toFixed(0)}%</b></div>
                  <div><span>Return</span><b className={s.returnPct >= 0 ? 'up' : 'down'}>{s.returnPct >= 0 ? '+' : ''}{s.returnPct.toFixed(1)}%</b></div>
                  <div><span>Net P&amp;L</span><b className={s.totalPnl >= 0 ? 'up' : 'down'}>{money(s.totalPnl)}</b></div>
                  <div><span>Avg win / loss</span><b>{money(s.avgWin)} / {money(s.avgLoss)}</b></div>
                  <div><span>Profit factor</span><b>{s.profitFactor === null ? '∞' : s.profitFactor.toFixed(2)}</b></div>
                  <div><span>Avg R / trade</span><b>{s.expectancyR.toFixed(2)}</b></div>
                  <div><span>Max drawdown</span><b className="down">-{s.maxDrawdownPct.toFixed(1)}%</b></div>
                </div>
                <Sparkline points={result!.equity} />
                <table className="bot-trades">
                  <thead><tr><th>Date</th><th>Side</th><th>Entry</th><th>Exit</th><th>P&amp;L</th></tr></thead>
                  <tbody>
                    {[...result!.trades].reverse().slice(0, 12).map((t) => (
                      <tr key={t.date}>
                        <td>{t.date.slice(5)}</td>
                        <td className={t.side === 'long' ? 'up' : 'down'}>{t.side}</td>
                        <td>{t.entry.toFixed(2)}</td>
                        <td>{t.exit.toFixed(2)} <small>{t.reason}</small></td>
                        <td className={t.pnl >= 0 ? 'up' : 'down'}>{money(t.pnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <div className="bot-caveat">
              A backtest only replays the past. Entries fill at the next bar's open plus 1¢ slippage, the stop is assumed hit first when a bar touches both levels, there are no commissions,
              and only the last ~59 days of 5-minute history exist, so few trades. Results do not predict what happens next.
            </div>
          </div>
        )}
      </div>

      <div className="bot-card">
        <div className="bot-title">Live</div>
        <label className="bot-toggle">
          <input type="checkbox" checked={config.watch} onChange={(e) => setConfig((c) => ({ ...c, watch: e.target.checked, auto: e.target.checked ? c.auto : false }))} />
          Watch {config.symbol} and alert on the breakout
        </label>
        <label className={`bot-toggle ${config.watch ? '' : 'off'}`}>
          <input type="checkbox" checked={config.auto} disabled={!config.watch} onChange={(e) => set('auto', e.target.checked)} />
          Also place the paper trade automatically
        </label>
        {status && <div className="bot-status">{status}</div>}
        <div className="bot-note">
          Runs while this page is open, during the regular session only. Trades the paper account only ({money(equity)} equity), at most once a day per symbol, ignores breakouts
          older than about 15 minutes, and skips a symbol you already hold. It can never touch real money.
        </div>
      </div>

      <div className="bot-card muted">
        <div className="bot-title">Not built yet</div>
        <p className="bot-desc">
          An SPX 0DTE bot is not possible here: Moomoo's API does not offer index options, and there is no historical options data to backtest honestly. A SPY-based
          version could be added later.
        </p>
      </div>
    </div>
  );
};

export { DEFAULT_BOT };
