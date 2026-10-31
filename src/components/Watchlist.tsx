import React, { useEffect, useRef, useState } from 'react';
import { RealMarketDataService, WatchQuote } from '../services/realMarketData';
import './Watchlist.css';

interface WatchlistProps {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

const STORAGE_KEY = 'watchlist';
const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'SPY', 'QQQ'];
const MAX_SYMBOLS = 40;
const POLL_MS = 5000;

type SortKey = 'manual' | 'change' | 'symbol';

const load = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.every((s) => typeof s === 'string')) return saved;
  } catch {
    /* use defaults */
  }
  return DEFAULT_SYMBOLS;
};

const pct = (v: number | null) => (v === null ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

const priceFmt = (p: number) => (p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toFixed(2));

export const Watchlist: React.FC<WatchlistProps> = ({ activeSymbol, onSelect }) => {
  const [symbols, setSymbols] = useState<string[]>(load);
  const [quotes, setQuotes] = useState<Record<string, WatchQuote>>({});
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({});
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('manual');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const prices = useRef<Record<string, number>>({});

  const marketData = RealMarketDataService.getInstance();
  const key = symbols.join(',');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    } catch {
      /* storage unavailable */
    }
  }, [symbols]);

  // Poll quotes for the whole list in one request, pausing while the tab is hidden
  useEffect(() => {
    if (!symbols.length) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const { quotes: list } = await marketData.getQuotes(symbols);
        if (cancelled) return;
        const next: Record<string, WatchQuote> = {};
        const flashes: Record<string, 'up' | 'down'> = {};
        list.forEach((q) => {
          next[q.symbol] = q;
          const prev = prices.current[q.symbol];
          if (prev !== undefined && prev !== q.price) flashes[q.symbol] = q.price > prev ? 'up' : 'down';
          prices.current[q.symbol] = q.price;
        });
        setQuotes((prev) => ({ ...prev, ...next }));
        setFailed(false);
        if (Object.keys(flashes).length) {
          setFlash(flashes);
          setTimeout(() => !cancelled && setFlash({}), 700);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key]);

  const add = async (raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return;
    if (symbols.some((s) => s.toUpperCase() === symbol)) {
      setError(`${symbol} is already in your watchlist`);
      return;
    }
    if (symbols.length >= MAX_SYMBOLS) {
      setError(`Watchlist is full (${MAX_SYMBOLS} symbols)`);
      return;
    }
    setError('');
    try {
      const { quotes: found } = await marketData.getQuotes([symbol]);
      if (!found.length) {
        setError(`Couldn't find "${symbol}"`);
        return;
      }
      setSymbols((prev) => [...prev, symbol]);
      setQuotes((prev) => ({ ...prev, [found[0].symbol]: found[0] }));
      prices.current[found[0].symbol] = found[0].price;
      setInput('');
    } catch {
      setError('Could not look up that symbol. Try again.');
    }
  };

  const remove = (symbol: string) => setSymbols((prev) => prev.filter((s) => s !== symbol));

  const rows = [...symbols].sort((a, b) => {
    if (sort === 'symbol') return a.localeCompare(b);
    if (sort === 'change') return (quotes[b]?.changePercent ?? -Infinity) - (quotes[a]?.changePercent ?? -Infinity);
    return 0;
  });

  const activeInList = symbols.some((s) => s.toUpperCase() === activeSymbol.toUpperCase());

  return (
    <div className="watchlist">
      <div className="watchlist-header">
        <h3>Watchlist</h3>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort">
          <option value="manual">Added</option>
          <option value="change">% Change</option>
          <option value="symbol">A–Z</option>
        </select>
      </div>

      <form
        className="watchlist-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(''); }}
          placeholder="Add symbol (e.g. AMD)"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Add symbol to watchlist"
        />
        <button type="submit" disabled={!input.trim()}>Add</button>
      </form>
      {error && <div className="watchlist-error">{error}</div>}

      {!activeInList && (
        <button type="button" className="watchlist-add-current" onClick={() => void add(activeSymbol)}>
          + Add {activeSymbol}
        </button>
      )}

      {failed && <div className="watchlist-error">Couldn't refresh quotes. Retrying…</div>}

      {symbols.length === 0 ? (
        <div className="watchlist-empty">Your watchlist is empty. Add a symbol above.</div>
      ) : (
        <div className="watchlist-rows">
          {rows.map((symbol) => {
            const q = quotes[symbol];
            const up = (q?.changePercent ?? 0) >= 0;
            const ext =
              q && q.marketState !== 'REGULAR'
                ? q.marketState.startsWith('PRE') && q.preMarketPrice !== null
                  ? { label: 'Pre', price: q.preMarketPrice, pct: q.preMarketChangePercent }
                  : q.postMarketPrice !== null
                    ? { label: 'AH', price: q.postMarketPrice, pct: q.postMarketChangePercent }
                    : null
                : null;
            return (
              <div
                key={symbol}
                className={`watch-row ${symbol.toUpperCase() === activeSymbol.toUpperCase() ? 'active' : ''} ${flash[symbol] ? `flash-${flash[symbol]}` : ''}`}
                onClick={() => onSelect(symbol)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(symbol); }}
              >
                <div className="watch-name">
                  <span className="watch-symbol">{symbol}</span>
                  <span className="watch-full">{q?.name || (loading ? '' : 'No data')}</span>
                </div>
                <div className="watch-quote">
                  {q ? (
                    <>
                      <span className="watch-price">{priceFmt(q.price)}</span>
                      <span className={`watch-change ${up ? 'up' : 'down'}`}>{pct(q.changePercent)}</span>
                      {ext && (
                        <span className="watch-ext">
                          {ext.label} {priceFmt(ext.price)} <span className={(ext.pct ?? 0) >= 0 ? 'up' : 'down'}>{pct(ext.pct)}</span>
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="watch-price muted">{loading ? '…' : '—'}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="watch-remove"
                  title={`Remove ${symbol}`}
                  onClick={(e) => { e.stopPropagation(); remove(symbol); }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
