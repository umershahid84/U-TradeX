import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PoliticianTrade,
  PoliticiansData,
  RosterEntry,
  amountRange,
  fetchPoliticianTrades,
  fetchRoster,
  filingDelayDays,
  matchRoster,
  ownerLabel,
  tradeSide,
} from '../services/politicians';
import './Politicians.css';

interface Props {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

type Scope = 'search' | 'watchlist';
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
 * Trades disclosed by members of Congress (Alpha Vantage, read by the local server and cached for a day). Search by
 * ticker, by politician, or both. Dates and dollar amounts are what the member reported: trades are filed up to 45
 * days late and amounts are only ranges.
 */
export const Politicians: React.FC<Props> = ({ activeSymbol, onSelect }) => {
  const [scope, setScope] = useState<Scope>('search');
  const [side, setSide] = useState<SideFilter>('all');
  const [chamber, setChamber] = useState<ChamberFilter>('all');
  // the search: a ticker, a politician, or both
  const [ticker, setTicker] = useState(activeSymbol);
  const [tickerDraft, setTickerDraft] = useState(activeSymbol);
  const [person, setPerson] = useState<RosterEntry | null>(null);
  const [personDraft, setPersonDraft] = useState('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterError, setRosterError] = useState('');
  const [open, setOpen] = useState(false);

  const [data, setData] = useState<PoliticiansData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // the watchlist sweep: what is saved for each watchlist symbol
  const [sweep, setSweep] = useState<Record<string, PoliticiansData>>({});
  const [sweeping, setSweeping] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (!person && !ticker) {
        setData(null);
        setError('');
        return;
      }
      setLoading(true);
      setError('');
      try {
        // a politician is fetched by name (then narrowed to the ticker here); otherwise by ticker
        setData(await fetchPoliticianTrades(ticker, { refresh, bioguideId: person?.id }));
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [ticker, person]
  );

  useEffect(() => {
    if (scope === 'search') void load();
  }, [scope, load]);

  // the list of politicians loads the first time the name box is used
  const loadRoster = useCallback(async () => {
    if (roster.length || rosterError) return;
    try {
      setRoster(await fetchRoster());
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
    }
  }, [roster.length, rosterError]);

  const suggestions = useMemo(() => (person ? [] : matchRoster(roster, personDraft)), [roster, personDraft, person]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (p: RosterEntry) => {
    setPerson(p);
    setPersonDraft(p.name);
    setOpen(false);
  };
  const clearPerson = () => {
    setPerson(null);
    setPersonDraft('');
  };
  const submitTicker = (e: React.FormEvent) => {
    e.preventDefault();
    setTicker(tickerDraft.trim().toUpperCase());
  };

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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSweeping(false);
    }
  };

  // everything in view before the buy/sell and chamber filters
  const base: PoliticianTrade[] = useMemo(() => {
    if (scope === 'watchlist') return Object.values(sweep).flatMap((d) => d.trades);
    const all = data?.trades ?? [];
    // a politician's trades are narrowed to the ticker typed beside them
    return person && ticker ? all.filter((t) => t.symbol.toUpperCase() === ticker) : all;
  }, [scope, data, sweep, person, ticker]);

  const trades: PoliticianTrade[] = useMemo(
    () =>
      base
        .filter((t) => (side === 'all' ? true : tradeSide(t) === side) && (chamber === 'all' || t.chamber.toUpperCase() === chamber))
        .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
        .slice(0, SHOWN),
    [base, side, chamber]
  );

  const recent = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const list = base.filter((t) => t.tradeDate >= cutoff);
    return { buys: list.filter((t) => tradeSide(t) === 'buy').length, sells: list.filter((t) => tradeSide(t) === 'sell').length };
  }, [base]);

  const meta = scope === 'search' ? data : null;
  // each row shows its ticker when the list mixes tickers
  const showTicker = scope === 'watchlist' || !!person;
  const truncated = !!meta && meta.total > meta.trades.length;

  return (
    <div className="politicians">
      <div className="pol-head">
        <h3>🏛 Politicians</h3>
        {scope === 'search' && (
          <button type="button" className="pol-refresh" disabled={loading} onClick={() => void load(true)} title="Fetch fresh data (counts against your Alpha Vantage allowance)">
            {loading ? '…' : '↻'}
          </button>
        )}
      </div>

      <div className="pol-tabs">
        <button type="button" className={scope === 'search' ? 'active' : ''} onClick={() => setScope('search')}>Search</button>
        <button type="button" className={scope === 'watchlist' ? 'active' : ''} onClick={() => setScope('watchlist')}>My watchlist</button>
      </div>

      {scope === 'search' && (
        <div className="pol-search" ref={boxRef}>
          <form className="pol-field" onSubmit={submitTicker}>
            <label htmlFor="pol-ticker">Ticker</label>
            <input
              id="pol-ticker"
              value={tickerDraft}
              placeholder="e.g. NVDA"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setTickerDraft(e.target.value.toUpperCase())}
              onBlur={() => setTicker(tickerDraft.trim().toUpperCase())}
            />
            {tickerDraft && <button type="button" className="pol-x" aria-label="Clear ticker" onClick={() => { setTickerDraft(''); setTicker(''); }}>✕</button>}
            {tickerDraft !== activeSymbol && (
              <button type="button" className="pol-chart" title="Use the symbol on the chart" onClick={() => { setTickerDraft(activeSymbol); setTicker(activeSymbol); }}>
                chart
              </button>
            )}
          </form>

          <div className="pol-field">
            <label htmlFor="pol-person">Politician</label>
            <input
              id="pol-person"
              value={personDraft}
              placeholder="Type a name, e.g. Pelosi"
              spellCheck={false}
              autoComplete="off"
              onFocus={() => { void loadRoster(); setOpen(true); }}
              onChange={(e) => {
                setPersonDraft(e.target.value);
                if (person) setPerson(null);
                setOpen(true);
                void loadRoster();
              }}
            />
            {(personDraft || person) && <button type="button" className="pol-x" aria-label="Clear politician" onClick={clearPerson}>✕</button>}
            {open && suggestions.length > 0 && (
              <ul className="pol-suggest" role="listbox">
                {suggestions.map((p) => (
                  <li key={p.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                    <b>{p.name}</b>
                    <span className={`pol-party ${partyClass(p.party)}`}>{p.party}-{p.state}</span>
                    <small>{p.chamber === 'SENATE' ? 'Senate' : 'House'}{p.active ? '' : ' · former'}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {rosterError && personDraft && !person && <div className="pol-warn">{rosterError}</div>}
          {person && ticker && <div className="pol-hint">Showing {person.name}’s trades in {ticker}.</div>}
        </div>
      )}

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
        {data && scope === 'search' ? ` · ${data.callsToday} call${data.callsToday === 1 ? '' : 's'} used today` : ''}
      </div>
      <div className="pol-summary">
        Last 90 days: <b className="up">{recent.buys} buys</b> · <b className="down">{recent.sells} sells</b>
        {truncated && meta ? ` (newest ${meta.trades.length} of ${meta.total} loaded)` : ''}
      </div>

      {loading && !data ? (
        <div className="pol-empty">Loading…</div>
      ) : scope === 'search' && !person && !ticker ? (
        <div className="pol-empty">Enter a ticker, pick a politician, or both.</div>
      ) : trades.length === 0 && !error ? (
        <div className="pol-empty">
          {scope === 'watchlist'
            ? 'Nothing saved yet. Use “Fetch more” to load your watchlist symbols.'
            : person && ticker
              ? `No disclosed ${ticker} trades by ${person.name}${truncated ? ' in the newest loaded' : ''} match these filters.`
              : 'No disclosed trades match these filters.'}
        </div>
      ) : (
        <div className="pol-list">
          {trades.map((t, i) => {
            const k = tradeSide(t);
            const delay = filingDelayDays(t);
            const clickable = showTicker && !!t.symbol;
            return (
              <div key={`${t.bioguideId}-${t.symbol}-${t.tradeDate}-${i}`} className="pol-row" onClick={() => clickable && onSelect(t.symbol)} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                <div className="pol-top">
                  <span className={`pol-type ${k}`}>{k === 'buy' ? 'BUY' : k === 'sell' ? 'SELL' : t.type || '?'}</span>
                  <b>{t.politician}</b>
                  <span className={`pol-party ${partyClass(t.party)}`}>{t.party}-{t.state}</span>
                </div>
                <div className="pol-sub">
                  {showTicker && <b>{t.symbol || t.assetName} · </b>}
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
