import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RealMarketDataService, ScanRow } from '../services/realMarketData';
import './Scanner.css';

interface Props {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

type View = 'up' | 'down' | 'volume' | 'day';

const VIEWS: { id: View; label: string }[] = [
  { id: 'up', label: 'Gap up' },
  { id: 'down', label: 'Gap down' },
  { id: 'volume', label: 'Volume' },
  { id: 'day', label: 'Day move' },
];

const REFRESH_MS = 30_000;
const SHOWN = 30;

const watchlistSymbols = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem('watchlist') ?? '[]');
    return Array.isArray(saved) ? saved.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const tone = (n: number | null) => (n === null ? '' : n >= 0 ? 'up' : 'down');

/** Market scanner: pre-market / after-hours / overnight gappers, volume surges and day movers across a liquid list plus your watchlist */
export const Scanner: React.FC<Props> = ({ activeSymbol, onSelect }) => {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [meta, setMeta] = useState<{ source: 'moomoo' | 'yahoo'; universe: number } | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('up');
  const [minPrice, setMinPrice] = useState(() => {
    try {
      return Number(localStorage.getItem('scanMinPrice')) || 2;
    } catch {
      return 2;
    }
  });

  const load = useCallback(async () => {
    try {
      const res = await RealMarketDataService.getInstance().getScan(watchlistSymbols());
      setRows(res.rows);
      setMeta({ source: res.source, universe: res.universe });
      setUpdatedAt(Date.now());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem('scanMinPrice', String(minPrice));
    } catch {
      /* storage unavailable */
    }
  }, [minPrice]);

  const shown = useMemo(() => {
    const ok = rows.filter((r) => r.price >= minPrice);
    const sorted =
      view === 'up' ? ok.filter((r) => (r.gapPct ?? 0) > 0).sort((a, b) => (b.gapPct ?? 0) - (a.gapPct ?? 0))
      : view === 'down' ? ok.filter((r) => (r.gapPct ?? 0) < 0).sort((a, b) => (a.gapPct ?? 0) - (b.gapPct ?? 0))
      : view === 'volume' ? ok.filter((r) => (r.volumeRatio ?? 0) >= 1.5).sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0))
      : ok.filter((r) => r.dayPct !== null).sort((a, b) => Math.abs(b.dayPct ?? 0) - Math.abs(a.dayPct ?? 0));
    return sorted.slice(0, SHOWN);
  }, [rows, view, minPrice]);

  const session = rows[0]?.session ?? '';
  const live = meta?.source === 'moomoo';

  return (
    <div className="scanner">
      <div className="scan-head">
        <h3>Market scanner</h3>
        <label>
          Min price $
          <input type="number" min="0" step="1" value={minPrice} onChange={(e) => setMinPrice(Math.max(0, parseFloat(e.target.value) || 0))} aria-label="Minimum price" />
        </label>
      </div>

      <div className="scan-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      <div className={`scan-source ${live ? 'live' : ''}`}>
        {meta
          ? `${rows.length} of ${meta.universe} symbols · ${live ? 'Moomoo, live' : 'Yahoo, delayed'}${session ? ` · ${session.toLowerCase()}` : ''}${updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}`
          : loading ? 'Scanning…' : ''}
      </div>

      {error && <div className="scan-error">Could not refresh the scan: {error}</div>}

      {!error && !loading && shown.length === 0 && (
        <div className="scan-empty">
          {view === 'volume' ? 'No symbol is trading at 1.5× normal volume or more right now.' : 'Nothing matches right now. Gaps show before the open and after the close.'}
        </div>
      )}

      {shown.length > 0 && (
        <table className="scan-table">
          <thead>
            <tr><th>Symbol</th><th>Price</th><th>Gap</th><th>Day</th><th>Vol×</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.symbol} className={r.symbol.toUpperCase() === activeSymbol.toUpperCase() ? 'active' : ''} onClick={() => onSelect(r.symbol)}>
                <td><b>{r.symbol}</b><small>{r.name}</small></td>
                <td>{r.price.toFixed(2)}</td>
                <td className={tone(r.gapPct)}>{pct(r.gapPct)}</td>
                <td className={tone(r.dayPct)}>{pct(r.dayPct)}</td>
                <td>{r.volumeRatio === null ? '—' : r.volumeRatio.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="scan-note">
        Gap = the open vs the previous close during the session, or the pre-market / after-hours / overnight move vs the last regular close.
        Vol× = volume vs normal for the time of day (during the session). The list is a built-in set of liquid stocks and ETFs plus your watchlist.
      </div>
    </div>
  );
};
