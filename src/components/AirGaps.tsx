import React, { useMemo, useState } from 'react';
import { AirGapSetup } from '../utils/airGap';
import { UNIVERSES } from '../utils/universes';
import { GapAlert, GapSettings } from '../hooks/useAirGapScanner';
import { playAlert, enableSound } from '../utils/alertSound';
import './AirGaps.css';

interface Props {
  settings: GapSettings;
  update: (patch: Partial<GapSettings>) => void;
  ranked: AirGapSetup[];
  setupCount: number;
  progress: { done: number; total: number; failed: number };
  /** Time of the newest candle among the setups */
  dataAsOf: number;
  updatedAt: number;
  board: GapAlert[];
  clearBoard: () => void;
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

type View = 'top3' | 'top10' | 'all' | 'alerts';

const money = (n: number) => n.toFixed(2);
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const STATE: Record<AirGapSetup['state'], string> = { setup: 'SETUP', entry: 'ENTRY', running: 'RUNNING', target: 'TARGET' };

const Row: React.FC<{ s: AirGapSetup; rank?: number; active: boolean; onSelect: (s: string) => void }> = ({ s, rank, active, onSelect }) => (
  <button type="button" className={`ag-row ${s.side} ${active ? 'active' : ''}`} onClick={() => onSelect(s.symbol)}>
    <div className="ag-top">
      {rank !== undefined && <i className="ag-rank">{rank}</i>}
      <b>{s.symbol}</b>
      <span className={`ag-side ${s.side}`}>{s.side === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
      <span className={`ag-state ${s.state}`}>{STATE[s.state]}</span>
      <span className="ag-price">${money(s.price)}</span>
    </div>
    <div className="ag-mid">
      <span>Target <b>${money(s.target)}</b> <small>({s.targetLabel})</small></span>
      <span>Room <b>${money(s.room)}</b> <small>{s.roomPct.toFixed(1)}% · {s.roomAtr.toFixed(1)} ATR</small></span>
    </div>
    <div className="ag-bar" title={`Air gap from $${money(s.gapFrom)} to $${money(s.gapTo)}`}>
      <i style={{ width: `${Math.min(100, (s.roomAtr / 6) * 100)}%` }} />
    </div>
    <div className="ag-bot">
      <span>Entry ${money(s.entry)} · Stop ${money(s.stop)}</span>
      <span title="Average daily range left today, against the room to the target">
        {s.atrLeft === null ? 'ATR left —' : `ATR left $${money(s.atrLeft)}`}
        {s.reach !== null && <b className={s.reach >= 1 ? 'up' : 'down'}> {s.reach >= 1 ? '✓ covers' : '✗ short'}</b>}
      </span>
      {!s.aligned && <span className="ag-warn">against trend</span>}
    </div>
  </button>
);

/**
 * Air Gap scanner: symbols whose price sits in front of a stretch of empty space before the next EMA cloud, ranked by room
 * to the target and the day's range left. Alerts (with sound) for new entries and target hits are kept in a board for the day.
 */
export const AirGaps: React.FC<Props> = ({ settings, update, ranked, setupCount, progress, dataAsOf, updatedAt, board, clearBoard, activeSymbol, onSelect }) => {
  const [view, setView] = useState<View>('top10');
  const shown = useMemo(() => (view === 'top3' ? ranked.slice(0, 3) : view === 'top10' ? ranked.slice(0, 10) : ranked.slice(0, 80)), [ranked, view]);
  const scanning = settings.running && progress.total > 0 && progress.done < progress.total;

  return (
    <div className="airgaps">
      <div className="ag-head">
        <h3>↕ Air gaps</h3>
        <button type="button" className={`ag-run ${settings.running ? 'on' : ''}`} onClick={() => { if (!settings.running) enableSound(); update({ running: !settings.running }); }}>
          {settings.running ? '■ Stop' : '▶ Start scan'}
        </button>
      </div>

      <div className="ag-controls">
        <label>List
          <select value={settings.universe} onChange={(e) => update({ universe: e.target.value as GapSettings['universe'] })}>
            {UNIVERSES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </label>
        <label>Candles
          <select value={settings.interval} onChange={(e) => update({ interval: e.target.value as GapSettings['interval'] })}>
            <option value="5m">5 min</option>
            <option value="15m">15 min</option>
          </select>
        </label>
        <label title="Fewest ATRs of empty space for a setup to be listed and alert">Min room
          <input type="number" min={0.5} max={6} step={0.5} value={settings.minRoomAtr} onChange={(e) => update({ minRoomAtr: Math.max(0.5, Math.min(6, parseFloat(e.target.value) || 1.5)) })} />
          <small>ATR</small>
        </label>
        <label className="ag-sound">
          <input type="checkbox" checked={settings.sound} onChange={(e) => { update({ sound: e.target.checked }); if (e.target.checked) { enableSound(); playAlert('entry'); } }} />
          🔔 Sound
        </label>
      </div>

      {settings.running && (
        <div className="ag-progress">
          {scanning ? (
            <>
              <div className="ag-prog-bar"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              <span>Scanning {progress.done} / {progress.total}{progress.failed ? ` · ${progress.failed} skipped` : ''}</span>
            </>
          ) : (
            <span>
              {setupCount} with an air gap · best candidates refresh every 30 s{updatedAt ? ` · updated ${time(updatedAt)} ET` : ''}
              {dataAsOf && Date.now() - dataAsOf > 25 * 60_000 ? ` · market closed: candles as of ${time(dataAsOf)} ET, no alerts` : ''}
            </span>
          )}
        </div>
      )}

      <div className="ag-tabs">
        {([['top3', 'Top 3'], ['top10', 'Top 10'], ['all', 'All'], ['alerts', `Alerts ${board.length}`]] as [View, string][]).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {view === 'alerts' ? (
        <div className="ag-list">
          {board.length === 0 ? (
            <div className="ag-empty">No alerts yet today. New entries and target hits appear here, with a sound if it is on.</div>
          ) : (
            <>
              {board.map((a) => (
                <button key={a.id} type="button" className={`ag-alert ${a.type} ${a.side}`} onClick={() => onSelect(a.symbol)}>
                  <span className="ag-at">{time(a.time)}</span>
                  <b>{a.symbol}</b>
                  <span>{a.type === 'entry' ? `${a.side === 'long' ? '▲' : '▼'} entry $${money(a.entry)} → ${a.targetLabel} $${money(a.target)} (${a.roomAtr.toFixed(1)} ATR)` : `🎯 target hit $${money(a.target)}`}</span>
                </button>
              ))}
              <button type="button" className="ag-clear" onClick={clearBoard}>Clear today's alerts</button>
            </>
          )}
        </div>
      ) : (
        <div className="ag-list">
          {!settings.running && ranked.length === 0 ? (
            <div className="ag-empty">Press <b>Start scan</b>. It checks every symbol in the list for empty space between its EMA clouds and ranks the best.</div>
          ) : shown.length === 0 ? (
            <div className="ag-empty">{scanning ? 'Scanning…' : `No setup with at least ${settings.minRoomAtr} ATR of room right now.`}</div>
          ) : (
            shown.map((s, i) => <Row key={s.symbol} s={s} rank={view === 'all' ? undefined : i + 1} active={s.symbol === activeSymbol} onSelect={onSelect} />)
          )}
        </div>
      )}

      <div className="ag-note">
        Air gap: empty space between two EMA clouds (5/12, 34/50, 72/89, 180/200). When price is on the far side of its own cloud and
        the next cloud is far away, nothing stands in the way, and that cloud's near edge is the target. Ranked by room (in ATRs) and
        how much of the day's usual range is left. The lists are approximate index membership, data is Yahoo's (delayed) and a
        pass over the Nasdaq 100 and S&amp;P 500 takes a minute or two. A rule-based screen, not a prediction or advice.
      </div>
    </div>
  );
};
