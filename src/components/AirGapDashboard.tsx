import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AirGapSetup } from '../utils/airGap';
import { UNIVERSES } from '../utils/universes';
import { GapAlert, GapSettings } from '../hooks/useAirGapScanner';
import { enableSound, playAlert } from '../utils/alertSound';
import { RealMarketDataService, WatchQuote } from '../services/realMarketData';
import { COLS, Rect, Rects, compact, loadRects, rowsOf, saveRects } from '../utils/gridLayout';
import './AirGapDashboard.css';

interface Props {
  settings: GapSettings;
  update: (patch: Partial<GapSettings>) => void;
  ranked: AirGapSetup[];
  setups: Record<string, AirGapSetup>;
  progress: { done: number; total: number; failed: number };
  updatedAt: number;
  dataAsOf: number;
  breadth: { up: number; down: number; total: number };
  board: GapAlert[];
  clearBoard: () => void;
  listInfo: Record<string, { source: 'moomoo' | 'fallback'; count: number; note?: string }>;
  onSelect: (symbol: string) => void;
  onClose: () => void;
}

type Direction = 'all' | 'long' | 'short' | 'mine';
type Layout = 'full' | 'focus' | 'table';

const money = (n: number) => n.toFixed(2);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const MARKETS = ['SPY', 'QQQ', 'IWM', '^VIX'];
const LAYOUT_KEY = 'airGapDashLayout';
const LOCK_KEY = 'airGapDashLocked';
const ROW_H = 32;

type PanelId = 'markets' | 'top3' | 'alerts' | 'table';
const PANEL_TITLES: Record<PanelId, string> = { markets: 'Markets', top3: 'Top 3 right now', alerts: "Today's alerts", table: 'Ranked table' };

/** Starting arrangement of each layout, in grid units (12 columns, rows of 32 px) */
const DEFAULTS: Record<Layout, Rects> = {
  full: { markets: { x: 0, y: 0, w: 2, h: 10 }, top3: { x: 2, y: 0, w: 7, h: 12 }, alerts: { x: 9, y: 0, w: 3, h: 22 }, table: { x: 0, y: 12, w: 9, h: 11 } },
  focus: { top3: { x: 0, y: 0, w: 9, h: 13 }, alerts: { x: 9, y: 0, w: 3, h: 13 } },
  table: { table: { x: 0, y: 0, w: 9, h: 22 }, alerts: { x: 9, y: 0, w: 3, h: 22 } },
};
const MIN: Record<PanelId, { w: number; h: number }> = { markets: { w: 2, h: 6 }, top3: { w: 4, h: 8 }, alerts: { w: 2, h: 6 }, table: { w: 4, h: 6 } };

const watchlist = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem('watchlist') ?? '[]');
    return Array.isArray(v) ? v.map((s: unknown) => String(s).toUpperCase()) : [];
  } catch {
    return [];
  }
};

/** How far price has travelled from the entry to the target, 0 to 1 (negative before the entry) */
const done = (s: AirGapSetup) => (s.target === s.entry ? 0 : (s.price - s.entry) / (s.target - s.entry));
/** Where price sits between the stop (0) and the target (1) */
const along = (s: AirGapSetup) => {
  const span = s.target - s.stop;
  return span === 0 ? 0 : Math.max(0, Math.min(1, (s.price - s.stop) / span));
};

const Card: React.FC<{ s: AirGapSetup; n: number; onSelect: (sym: string) => void }> = ({ s, n, onSelect }) => {
  const long = s.side === 'long';
  const pctLeft = s.dailyAtr && s.atrLeft !== null ? Math.round((s.atrLeft / s.dailyAtr) * 100) : null;
  const progress = Math.max(0, Math.round(done(s) * 100));
  return (
    <div className={`agd-card ${s.side}`}>
      <div className="agd-card-head">
        <b>#{n}</b>
        <button type="button" className="agd-sym" onClick={() => onSelect(s.symbol)} title="Open the chart">{s.symbol}</button>
        <span className={`agd-pill ${s.side}`}>{long ? '▲ BULLISH' : '▼ BEARISH'}</span>
        <span className={`agd-pill state ${s.state}`}>{s.state.toUpperCase()}</span>
        {!s.aligned && <span className="agd-pill warn">against trend</span>}
        <span className={`agd-src ${s.source}`}>{s.source === 'moomoo' ? 'Moomoo live' : 'Yahoo'}</span>
      </div>
      <div className="agd-boxes">
        <div><small>NOW</small><b>${money(s.price)}</b></div>
        <div><small>STOP</small><b className="down">${money(s.stop)}</b></div>
        <div><small>TARGET · {s.targetLabel}</small><b className="up">${money(s.target)}</b></div>
      </div>
      <div className="agd-stats">
        <span>ATR left <b>${s.atrLeft === null ? '—' : money(s.atrLeft)}</b></span>
        <span>Risk <b>${money(Math.abs(s.price - s.stop))}</b></span>
        <span>Gap <b>${money(s.room)}</b></span>
        <span>{progress}% done</span>
      </div>
      <div className="agd-track" aria-label="Stop, now, target">
        <i className="agd-fill" style={{ width: `${along(s) * 100}%` }} />
        <i className="agd-now" style={{ left: `${along(s) * 100}%` }} />
        <div className="agd-track-labels"><span>stop</span><span>now</span><span>target</span></div>
      </div>
      <div className="agd-why">
        {s.symbol} is #{n}: air gap {long ? 'up' : 'down'} of {s.roomAtr.toFixed(1)} ATR to the {s.targetLabel}
        {pctLeft !== null ? `, with ${pctLeft}% of the day's ATR left` : ''}.
      </div>
      <details className="agd-details">
        <summary>Why</summary>
        <div className="agd-clouds">
          {s.clouds.map((c) => <span key={c.label}>{c.label}: ${money(c.bottom)}–${money(c.top)}</span>)}
          <span>Entry ${money(s.entry)} · {s.reach === null ? 'range left unknown' : s.reach >= 1 ? 'the day\'s range covers the move' : 'the day\'s range is short of the move'}</span>
        </div>
      </details>
    </div>
  );
};

/**
 * A full-screen air gap dashboard: markets and breadth, the best three setups as cards, today's alerts with live status,
 * and the ranked table. Panels can be switched between Full, Focus (cards and alerts) and Table layouts.
 */
export const AirGapDashboard: React.FC<Props> = ({ settings, update, ranked, setups, progress, updatedAt, dataAsOf, breadth, board, clearBoard, listInfo, onSelect, onClose }) => {
  const [direction, setDirection] = useState<Direction>('all');
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      return v === 'focus' || v === 'table' ? v : 'full';
    } catch {
      return 'full';
    }
  });
  const [tableAll, setTableAll] = useState(false);
  // draggable panels: where each one is (per layout), whether the arrangement is locked, and the drag in progress
  const [rects, setRects] = useState<Rects>(() => loadRects(`airGapDashGrid:${layout}`, DEFAULTS[layout]));
  const [locked, setLocked] = useState(() => {
    try {
      return localStorage.getItem(LOCK_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [drag, setDrag] = useState<{ id: PanelId; mode: 'move' | 'resize'; px: number; py: number; orig: Rect; dx: number; dy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // narrow screens stack the panels instead
  const free = width >= 900;
  const cellW = width / COLS;
  const [quotes, setQuotes] = useState<WatchQuote[]>([]);

  const pickLayout = (l: Layout) => {
    setLayout(l);
    setRects(loadRects(`airGapDashGrid:${l}`, DEFAULTS[l]));
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    let live = true;
    const load = () =>
      RealMarketDataService.getInstance()
        .getQuotes(MARKETS)
        .then((r) => live && setQuotes(r.quotes))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 15_000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const mine = useMemo(() => new Set(watchlist()), [ranked.length]);
  const list = useMemo(
    () => ranked.filter((s) => (direction === 'all' ? true : direction === 'long' ? s.side === 'long' : direction === 'short' ? s.side === 'short' : mine.has(s.symbol))),
    [ranked, direction, mine]
  );
  const toggleLock = () => {
    setLocked((v) => {
      try {
        localStorage.setItem(LOCK_KEY, v ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  };
  const resetLayout = () => {
    setRects(DEFAULTS[layout]);
    saveRects(`airGapDashGrid:${layout}`, DEFAULTS[layout]);
  };

  /** Where every panel is right now: the stored arrangement, or the one a drag in progress would produce */
  const shown: Rects = useMemo(() => {
    if (!drag) return rects;
    const o = drag.orig;
    const next: Rect =
      drag.mode === 'move'
        ? { ...o, x: Math.max(0, Math.min(COLS - o.w, Math.round(o.x + drag.dx / cellW))), y: Math.max(0, Math.round(o.y + drag.dy / ROW_H)) }
        : { ...o, w: Math.max(MIN[drag.id].w, Math.min(COLS - o.x, Math.round(o.w + drag.dx / cellW))), h: Math.max(MIN[drag.id].h, Math.round(o.h + drag.dy / ROW_H)) };
    return compact({ ...rects, [drag.id]: next }, drag.id);
  }, [rects, drag, cellW]);

  const startDrag = (id: PanelId, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (locked || !free || e.button > 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, summary')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, px: e.clientX, py: e.clientY, orig: rects[id], dx: 0, dy: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.px, dy: e.clientY - drag.py });
  };
  const endDrag = () => {
    if (!drag) return;
    const done = compact(shown);
    setRects(done);
    saveRects(`airGapDashGrid:${layout}`, done);
    setDrag(null);
  };

  const scanning = settings.running && progress.total > 0 && progress.done < progress.total;
  const entries = board.filter((a) => a.type === 'entry').length;
  const targets = board.filter((a) => a.type === 'target').length;
  const info = listInfo[settings.universe === 'ndx' ? 'ndx' : settings.universe === 'russell' ? 'russell3000' : 'sp500'];
  const upPct = breadth.total ? Math.round((breadth.up / breadth.total) * 100) : 0;
  const closed = dataAsOf > 0 && Date.now() - dataAsOf > 25 * 60_000;

  return (
    <div className="agd" role="dialog" aria-label="Air gap dashboard">
      <div className="agd-bar">
        <h2>↕ Air Gap scanner</h2>
        <span className="agd-status">
          {!settings.running ? 'Stopped' : scanning ? `Scanning ${progress.done} / ${progress.total}${progress.failed ? ` · ${progress.failed} skipped` : ''}` : `${Object.keys(setups).length} with a gap · updated ${updatedAt ? clock(updatedAt) : '—'} ET`}
          {closed ? ` · market closed (candles as of ${clock(dataAsOf)} ET, no alerts)` : ''}
        </span>
        <div className="agd-grow" />
        <button type="button" className={`agd-run ${settings.running ? 'on' : ''}`} onClick={() => { if (!settings.running) enableSound(); update({ running: !settings.running }); }}>
          {settings.running ? '■ Stop' : '▶ Scan now'}
        </button>
        <button type="button" className="agd-close" onClick={onClose} aria-label="Close dashboard">✕</button>
      </div>

      <div className="agd-controls">
        <div className="agd-chips" role="group" aria-label="List">
          {UNIVERSES.map((u) => (
            <button key={u.id} type="button" className={settings.universe === u.id ? 'on' : ''} onClick={() => update({ universe: u.id })}>{u.label}</button>
          ))}
        </div>
        <label>Candles
          <select value={settings.interval} onChange={(e) => update({ interval: e.target.value as GapSettings['interval'] })}>
            <option value="5m">5 min</option>
            <option value="15m">15 min</option>
          </select>
        </label>
        <label>Min room
          <input type="number" min={0.5} max={6} step={0.5} value={settings.minRoomAtr} onChange={(e) => update({ minRoomAtr: Math.max(0.5, Math.min(6, parseFloat(e.target.value) || 1.5)) })} /> ATR
        </label>
        <label className="agd-check">
          <input type="checkbox" checked={settings.sound} onChange={(e) => { update({ sound: e.target.checked }); if (e.target.checked) { enableSound(); playAlert('entry'); } }} /> 🔔 Sound
        </label>
        <div className="agd-chips" role="group" aria-label="Direction">
          {([['all', 'All'], ['long', '▲ Bullish'], ['short', '▼ Bearish'], ['mine', '★ My list']] as [Direction, string][]).map(([id, label]) => (
            <button key={id} type="button" className={direction === id ? 'on' : ''} onClick={() => setDirection(id)}>{label}</button>
          ))}
        </div>
        <div className="agd-chips" role="group" aria-label="Layout">
          {([['full', 'Full'], ['focus', 'Focus'], ['table', 'Table']] as [Layout, string][]).map(([id, label]) => (
            <button key={id} type="button" className={layout === id ? 'on' : ''} onClick={() => pickLayout(id)}>{label}</button>
          ))}
        </div>
      </div>
      {info && (
        <div className={`agd-source ${info.source}`}>
          {info.source === 'moomoo' ? `✓ List from Moomoo: ${info.count} symbols${info.note ? ` (${info.note})` : ''}` : `List: ${settings.universe === 'russell' ? 'imported' : 'built-in, approximate'} (${info.count} symbols)${info.note ? ` · ${info.note}` : ''}`}
        </div>
      )}

      {(() => {
        const grab = (id: PanelId) => ({
          className: locked || !free ? '' : 'agd-grab',
          title: locked || !free ? undefined : 'Drag to move this panel',
          onPointerDown: startDrag(id, 'move'),
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        });
        const bodies: Record<PanelId, React.ReactNode> = {
      markets: (
        <>
            <h3 {...grab('markets')}>Markets</h3>
            {MARKETS.map((m) => {
              const q = quotes.find((x) => x.symbol.toUpperCase() === m);
              return (
                <div key={m} className="agd-mrow">
                  <b>{m.replace('^', '')}</b>
                  <span>{q ? q.price.toFixed(2) : '—'}</span>
                  <span className={q && (q.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{q && q.changePercent !== null ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : ''}</span>
                </div>
              );
            })}
            <div className="agd-breadth">
              <div className="agd-breadth-head"><b>Breadth</b><span>{breadth.up.toLocaleString()} up · {breadth.down.toLocaleString()} down</span></div>
              <div className="agd-breadth-bar" title={`${upPct}% of scanned stocks are up today`}><i style={{ width: `${upPct}%` }} /></div>
              <small>{breadth.total ? `${upPct}% of the ${breadth.total.toLocaleString()} stocks scanned are up` : 'Start a scan to measure breadth'}</small>
            </div>
        </>
      ),
      top3: (
        <>
            <h3 {...grab('top3')}>Top 3 right now <small>rows 1–3 of the top {Math.min(10, list.length)}</small></h3>
            {list.length === 0 ? (
              <div className="agd-empty">{settings.running ? (scanning ? 'Scanning…' : `No setup with at least ${settings.minRoomAtr} ATR of room right now.`) : 'Press Scan now. The best three air gaps appear here as cards.'}</div>
            ) : (
              <div className="agd-cards">{list.slice(0, 3).map((s, i) => <Card key={s.symbol} s={s} n={i + 1} onSelect={onSelect} />)}</div>
            )}
        </>
      ),
      alerts: (
        <>
          <h3 {...grab('alerts')}>Today's alerts</h3>
          <div className="agd-counts">
            <span>Entries <b>{entries}</b></span>
            <span>Targets hit <b className="up">{targets}</b></span>
            {board.length > 0 && <button type="button" onClick={clearBoard}>Clear</button>}
          </div>
          <div className="agd-alist">
            {board.length === 0 && <div className="agd-empty">No alerts yet today. New entries and target hits appear here, with a sound if it is on.</div>}
            {board.map((a) => {
              const live = setups[a.symbol];
              const used = live && live.side === a.side && a.target !== a.entry ? Math.round(((live.price - a.entry) / (a.target - a.entry)) * 100) : null;
              return (
                <button key={a.id} type="button" className={`agd-alert ${a.type} ${a.side}`} onClick={() => onSelect(a.symbol)}>
                  <span className="agd-at">{clock(a.time)}</span>
                  <span className={`agd-pill ${a.side}`}>{a.type === 'target' ? '🎯 TARGET' : a.side === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
                  <b>{a.symbol}</b>
                  <span className="agd-asub">{a.type === 'entry' ? `in $${money(a.entry)} → ${a.targetLabel} $${money(a.target)}` : `reached $${money(a.target)}`}</span>
                  {used !== null && a.type === 'entry' && <span className={`agd-live ${used >= 0 ? 'up' : 'down'}`}>{used >= 0 ? `running in profit · ${Math.min(used, 999)}% of room used` : 'running at a loss'}</span>}
                </button>
              );
            })}
          </div>
        </>
      ),
      table: (
        <>
            <h3 {...grab('table')}>
              {tableAll ? 'All setups' : 'Top 10'} <small>sorted by setup strength · click a row for the chart</small>
              <button type="button" className="agd-more" onClick={() => setTableAll((v) => !v)}>{tableAll ? 'Show top 10' : 'Show all'}</button>
            </h3>
            <div className="agd-scroll">
              <table>
                <thead><tr><th>#</th><th>Symbol</th><th>Side</th><th>State</th><th>Price</th><th>Target</th><th>Room</th><th>Room (ATR)</th><th>ATR left</th><th>Source</th></tr></thead>
                <tbody>
                  {(tableAll ? list.slice(0, 200) : list.slice(0, 10)).map((s, i) => (
                    <tr key={s.symbol} onClick={() => onSelect(s.symbol)}>
                      <td>{i + 1}</td>
                      <td><b>{s.symbol}</b></td>
                      <td className={s.side === 'long' ? 'up' : 'down'}>{s.side === 'long' ? '▲ long' : '▼ short'}{!s.aligned ? ' ·' : ''}{!s.aligned && <em> vs trend</em>}</td>
                      <td>{s.state}</td>
                      <td>${money(s.price)}</td>
                      <td>${money(s.target)} <small>{s.targetLabel}</small></td>
                      <td>${money(s.room)} <small>{s.roomPct.toFixed(1)}%</small></td>
                      <td>{s.roomAtr.toFixed(1)}</td>
                      <td className={s.reach !== null && s.reach >= 1 ? 'up' : 'down'}>{s.atrLeft === null ? '—' : `$${money(s.atrLeft)}`}</td>
                      <td><span className={`agd-src ${s.source}`}>{s.source === 'moomoo' ? 'Moomoo' : 'Yahoo'}</span></td>
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan={10} className="agd-empty">Nothing to show yet.</td></tr>}
                </tbody>
              </table>
            </div>
        </>
      ),
        };
        const visible: PanelId[] = layout === 'full' ? ['markets', 'top3', 'alerts', 'table'] : layout === 'focus' ? ['top3', 'alerts'] : ['table', 'alerts'];
        const canMove = free && !locked;
        return (
          <>
            <div className="agd-tools">
              <button type="button" onClick={toggleLock} title={locked ? 'Unlock to drag and resize the panels' : 'Lock the arrangement'}>{locked ? '🔒 Locked' : '🔓 Unlocked'}</button>
              <button type="button" onClick={resetLayout}>↺ Reset layout</button>
              <span>{free ? (locked ? 'Unlock to rearrange the panels.' : 'Drag a panel by its title, resize it from its bottom-right corner. Saved for each layout.') : 'Panels stack on a narrow screen.'}</span>
            </div>
            <div
              ref={canvasRef}
              className={`agd-canvas ${free ? 'free' : 'stack'} ${drag ? 'dragging' : ''}`}
              style={free ? { height: Math.max(rowsOf(shown) * ROW_H, 200) + 8 } : undefined}
            >
              {visible.map((id) => {
                const r = shown[id] ?? DEFAULTS[layout][id];
                const moving = drag?.id === id && drag.mode === 'move';
                const style: React.CSSProperties = free
                  ? {
                      left: moving ? drag!.orig.x * cellW + drag!.dx : r.x * cellW,
                      top: moving ? drag!.orig.y * ROW_H + drag!.dy : r.y * ROW_H,
                      width: r.w * cellW,
                      height: r.h * ROW_H,
                    }
                  : {};
                return (
                  <React.Fragment key={id}>
                    {moving && <div className="agd-ghost" style={{ left: r.x * cellW, top: r.y * ROW_H, width: r.w * cellW, height: r.h * ROW_H }} />}
                    <div className={`agd-cell ${moving ? 'moving' : ''}`} style={style} data-panel={id}>
                      <section className={`agd-panel agd-${id}`} aria-label={PANEL_TITLES[id]}>
                        {bodies[id]}
                      </section>
                      {canMove && (
                        <div className="agd-resize" title="Drag to resize" onPointerDown={startDrag(id, 'resize')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </>
        );
      })()}

      <div className="agd-note">
        Air gap: empty space between two EMA clouds. A rule-based screen of Moomoo and Yahoo candles (Yahoo can be delayed). Educational, not a prediction or advice.
      </div>
    </div>
  );
};
