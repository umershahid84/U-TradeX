import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PoliticianTrade, PoliticiansData, amountRange, fetchPoliticianTrades, filingDelayDays, ownerLabel, tradeSide } from '../services/politicians';
import './Politicians.css';

interface Props {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

type Scope = 'symbol' | 'watchlist';
type SideFilter = 'all' | 'buy' | 'sell';
type ChamberFilter = 'all' | 'HOUSE' | 'SENATE';

const SWEEP_BATCH = 5;
const SHOWN = 60;

const watchlistSymbols = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem('watchlist') ?? '[]');
    return Array.isArray(saved) ? saved.filter((s): s is string => typeof s === 'string').map((s) => s.toUpperCase()) : [];
  } catch {
    return [];
  }
};

const ago = (ms: number) => {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 2 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

const partyClass = (p: string) => (p.startsWith('R') ? 'rep' : p.startsWith('D') ? 'dem' : 'ind');

/**
 * Trades disclosed by members of Congress (Alpha Vantage, read by the local server and cached for a day). Dates and
 * dollar amounts are what the member reported: trades are filed up to 45 days late and amounts are only ranges.
 */
export const Politicians: React.FC<Props> = ({ activeSymbol, onSelect }) => {
  const [scope, setScope] = useState<Scope>('symbol');
  const [side, setSide] = useState<SideFilter>('all');
  const [chamber, setChamber] = useState<ChamberFilter>('all');
  const [data, setData] = useState<PoliticiansData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // the watchlist sweep: what is saved for each watchlist symbol
  const [sweep, setSweep] = useState<Record<string, PoliticiansData>>({});
  const [sweeping, setSweeping] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError('');
      try {
        setData(await fetchPoliticianTrades(activeSymbol, { refresh }));
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeSymbol]
  );

  useEffect(() => {
    if (scope === 'symbol') void load();
  }, [scope, load]);

  // saved data for the watchlist, without spending any Alpha Vantage calls
  const loadSaved = useCallback(async () => {
    const out: Record<string, PoliticiansData> = {};
    for (const s of watchlistSymbols()) {
      try {
        const d = await fetchPoliticianTrades(s, { cacheOnly: true });
        if (d.trades.length || d.fetchedAt) out[s] = d;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setSweep(out);
  }, []);

  useEffect(() => {
    if (scope === 'watchlist') {
      setError('');
      void loadSaved();
    }
  }, [scope, loadSaved]);

  const uncached = watchlistSymbols().filter((s) => !sweep[s]?.fetchedAt);
  const fetchMore = async () => {
    setSweeping(true);
    setError('');
    try {
      for (const s of uncached.slice(0, SWEEP_BATCH)) {
        const d = await fetchPoliticianTrades(s);
        setSweep((prev) => ({ ...prev, [s]: d }));
        setData(d);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSweeping(false);
    }
  };

  const trades: PoliticianTrade[] = useMemo(() => {
    const all = scope === 'symbol' ? data?.trades ?? [] : Object.values(sweep).flatMap((d) => d.trades);
    return all
      .filter((t) => (side === 'all' ? true : tradeSide(t) === side) && (chamber === 'all' || t.chamber.toUpperCase() === chamber))
      .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
      .slice(0, SHOWN);
  }, [scope, data, sweep, side, chamber]);

  const recent = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const list = (scope === 'symbol' ? data?.trades ?? [] : Object.values(sweep).flatMap((d) => d.trades)).filter((t) => t.tradeDate >= cutoff);
    return { buys: list.filter((t) => tradeSide(t) === 'buy').length, sells: list.filter((t) => tradeSide(t) === 'sell').length };
  }, [scope, data, sweep]);

  const meta = scope === 'symbol' ? data : null;

  return (
    <div className="politicians">
      <div className="pol-head">
        <h3>🏛 Politicians</h3>
        {scope === 'symbol' && (
          <button type="button" className="pol-refresh" disabled={loading} onClick={() => void load(true)} title="Fetch fresh data (counts against your Alpha Vantage allowance)">
            {loading ? '…' : '↻'}
          </button>
        )}
      </div>

      <div className="pol-tabs">
        <button type="button" className={scope === 'symbol' ? 'active' : ''} onClick={() => setScope('symbol')}>{activeSymbol}</button>
        <button type="button" className={scope === 'watchlist' ? 'active' : ''} onClick={() => setScope('watchlist')}>My watchlist</button>
      </div>

      <div className="pol-filters">
        {(['all', 'buy', 'sell'] as SideFilter[]).map((s) => (
          <button key={s} type="button" className={side === s ? 'active' : ''} onClick={() => setSide(s)}>{s === 'all' ? 'All' : s === 'buy' ? 'Buys' : 'Sells'}</button>
        ))}
        <span />
        {(['all', 'HOUSE', 'SENATE'] as ChamberFilter[]).map((c) => (
          <button key={c} type="button" className={chamber === c ? 'active' : ''} onClick={() => setChamber(c)}>{c === 'all' ? 'Both' : c === 'HOUSE' ? 'House' : 'Senate'}</button>
        ))}
      </div>

      {scope === 'watchlist' && (
        <div className="pol-sweep">
          <span>
            {Object.keys(sweep).length} of {watchlistSymbols().length} watchlist symbols saved.
          </span>
          {uncached.length > 0 && (
            <button type="button" disabled={sweeping} onClick={() => void fetchMore()} title="Each symbol is one Alpha Vantage call">
              {sweeping ? 'Fetching…' : `Fetch ${Math.min(SWEEP_BATCH, uncached.length)} more`}
            </button>
          )}
        </div>
      )}

      {error && <div className="pol-error">{error}</div>}
      {meta?.note && <div className="pol-warn">{meta.note}</div>}

      <div className="pol-source">
        Source: Alpha Vantage
        {meta ? ` · ${meta.stale ? 'saved copy' : meta.cached ? 'saved today' : 'just fetched'}, updated ${ago(meta.fetchedAt)}` : ''}
        {data ? ` · ${data.callsToday} call${data.callsToday === 1 ? '' : 's'} used today` : ''}
      </div>
      <div className="pol-summary">
        Last 90 days: <b className="up">{recent.buys} buys</b> · <b className="down">{recent.sells} sells</b>
        {meta && meta.total > meta.trades.length ? ` (newest ${meta.trades.length} of ${meta.total} loaded)` : ''}
      </div>

      {loading && !data ? (
        <div className="pol-empty">Loading…</div>
      ) : trades.length === 0 && !error ? (
        <div className="pol-empty">{scope === 'symbol' ? `No disclosed trades for ${activeSymbol} match these filters.` : 'Nothing saved yet. Use “Fetch more” to load your watchlist symbols.'}</div>
      ) : (
        <div className="pol-list">
          {trades.map((t, i) => {
            const k = tradeSide(t);
            const delay = filingDelayDays(t);
            return (
              <div key={`${t.bioguideId}-${t.symbol}-${t.tradeDate}-${i}`} className="pol-row" onClick={() => scope === 'watchlist' && t.symbol && onSelect(t.symbol)} style={{ cursor: scope === 'watchlist' ? 'pointer' : 'default' }}>
                <div className="pol-top">
                  <span className={`pol-type ${k}`}>{k === 'buy' ? 'BUY' : k === 'sell' ? 'SELL' : t.type || '?'}</span>
                  <b>{t.politician}</b>
                  <span className={`pol-party ${partyClass(t.party)}`}>{t.party}-{t.state}</span>
                </div>
                <div className="pol-sub">
                  {scope === 'watchlist' && <b>{t.symbol} · </b>}
                  {t.tradeDate} · {amountRange(t)} · {t.chamber === 'SENATE' ? 'Senate' : 'House'} · {ownerLabel(t.owner)}
                  {t.assetType && t.assetType !== 'ST' ? ` · ${t.assetType}` : ''}
                  {delay !== null ? ` · filed ${delay}d later` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pol-note">
        Disclosures can be filed up to 45 days after the trade, and amounts are only ranges. “Spouse” and “Dependent”
        trades are not the member’s own. This is public record, not a signal and not advice. Data runs on your own computer
        only; your Alpha Vantage key never leaves it.
      </div>
    </div>
  );
};
