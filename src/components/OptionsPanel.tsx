import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { OptionContract, ChartData } from '../types';
import { OptionsDirectionGuide } from './OptionsDirectionGuide';
import { OptionPnlEstimate } from './OptionPnlEstimate';
import { solveIv, yearsToExpiry } from '../utils/optionPricing';
import { RealMarketDataService, OptionChainData } from '../services/realMarketData';
import { OptionSide, RatedOption, daysToExpiry, rankOtmOptions } from '../utils/optionScoring';
import './OptionsPanel.css';

interface OptionsPanelProps {
  symbol: string;
  currentPrice: number;
  balance: number;
  chartData: ChartData[];
  chartLabel: string;
  onBuyOption: (option: Omit<OptionContract, 'quantity'> & { quantity: number }) => void;
}

interface ExpiryChain {
  expiry: string;
  calls: OptionChainData[];
  puts: OptionChainData[];
}

interface Selection {
  expiry: string;
  option: OptionChainData;
}

// Expiries scanned for the best contracts: far enough out to have time, not so far they are illiquid
const SCAN_MIN_DTE = 5;
const SCAN_MAX_DTE = 75;
const SCAN_MAX_EXPIRIES = 5;
const REFRESH_MS = 60_000;

const fmtExpiry = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Estimated fill: the bid/ask midpoint, falling back to the last trade when there is no quote
const fillPrice = (o: OptionChainData): number => (o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o.lastPrice);

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  symbol,
  currentPrice,
  balance,
  chartData,
  chartLabel,
  onBuyOption,
}) => {
  const [optionType, setOptionType] = useState<OptionSide>('call');
  const [view, setView] = useState<'best' | 'chain'>('best');
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [chains, setChains] = useState<Record<string, ExpiryChain>>({});
  const [chainExpiry, setChainExpiry] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const marketData = RealMarketDataService.getInstance();

  const loadChain = useCallback(
    async (expiry: string): Promise<ExpiryChain | null> => {
      const result = await marketData.fetchOptionsChain(symbol, expiry);
      if (!result.length) return null;
      return { expiry, calls: result[0].calls || [], puts: result[0].puts || [] };
    },
    [symbol]
  );

  // Load expirations, then the chains for the expiries worth scanning
  useEffect(() => {
    let cancelled = false;
    setSelected(null);
    setChains({});
    setExpiryDates([]);
    setError('');

    const run = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const dates = await marketData.getOptionExpirations(symbol);
        if (cancelled) return;
        if (!dates.length) {
          setError(`No options are listed for ${symbol}`);
          return;
        }
        setExpiryDates(dates);
        setChainExpiry((prev) => (prev && dates.includes(prev) ? prev : dates[0]));

        let scan = dates.filter((d) => {
          const dte = daysToExpiry(d);
          return dte >= SCAN_MIN_DTE && dte <= SCAN_MAX_DTE;
        });
        if (!scan.length) scan = dates.slice(0, 3);
        scan = scan.slice(0, SCAN_MAX_EXPIRIES);

        const loaded = await Promise.all(scan.map(loadChain));
        if (cancelled) return;
        const next: Record<string, ExpiryChain> = {};
        loaded.forEach((c) => { if (c) next[c.expiry] = c; });
        if (!Object.keys(next).length) setError('Could not load the options chain. Try again shortly.');
        else setError('');
        setChains((prev) => ({ ...prev, ...next }));
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };

    void run(true);
    const id = setInterval(() => void run(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol, loadChain]);

  // Full-chain view can show any expiry, so fetch ones that were not scanned
  useEffect(() => {
    if (view !== 'chain' || !chainExpiry || chains[chainExpiry]) return;
    let cancelled = false;
    setLoading(true);
    loadChain(chainExpiry)
      .then((c) => { if (!cancelled && c) setChains((prev) => ({ ...prev, [c.expiry]: c })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, chainExpiry, chains, loadChain]);

  const ranked = useMemo(
    () => (currentPrice > 0 ? rankOtmOptions(optionType, Object.values(chains), currentPrice) : []),
    [chains, optionType, currentPrice]
  );

  const chainRows = useMemo(() => {
    const chain = chains[chainExpiry];
    if (!chain || currentPrice <= 0) return [];
    const list = optionType === 'call' ? chain.calls : chain.puts;
    return [...list]
      .sort((a, b) => Math.abs(a.strike - currentPrice) - Math.abs(b.strike - currentPrice))
      .slice(0, 12)
      .sort((a, b) => a.strike - b.strike);
  }, [chains, chainExpiry, optionType, currentPrice]);

  const select = (expiry: string, option: OptionChainData) => setSelected({ expiry, option });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) {
      alert('Please select a contract');
      return;
    }
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) {
      alert('Please enter a valid quantity');
      return;
    }
    const premium = fillPrice(selected.option);
    if (premium * qty * 100 > balance) {
      alert('Insufficient balance');
      return;
    }
    onBuyOption({
      symbol,
      type: optionType,
      strike: selected.option.strike,
      expiry: selected.expiry,
      premium,
      quantity: qty,
      // Volatility implied by the price paid, so the position starts at ~$0 P/L
      impliedVolatility:
        solveIv(optionType, currentPrice, selected.option.strike, premium, yearsToExpiry(selected.expiry)) ??
        selected.option.impliedVolatility,
    });
    setQuantity('1');
    setSelected(null);
  };

  const premium = selected ? fillPrice(selected.option) : 0;
  const estimatedCost = premium * (parseInt(quantity || '1') || 0) * 100;

  const selectedRating: RatedOption | undefined = selected
    ? ranked.find((r) => r.expiry === selected.expiry && r.contract.strike === selected.option.strike)
    : undefined;

  const isSelected = (expiry: string, strike: number) =>
    selected?.expiry === expiry && selected.option.strike === strike;

  return (
    <div className="options-panel">
      <h3>Options Trading</h3>

      <OptionsDirectionGuide
        symbol={symbol}
        data={chartData}
        chartLabel={chartLabel}
        onUseSuggestion={(side) => { setOptionType(side); setView('best'); setSelected(null); }}
      />

      <form onSubmit={handleSubmit} className="options-form">
        <div className="form-group">
          <label>Option Type</label>
          <div className="option-type-selector">
            <button
              type="button"
              className={optionType === 'call' ? 'active call' : 'call'}
              onClick={() => { setOptionType('call'); setSelected(null); }}
            >
              CALL
            </button>
            <button
              type="button"
              className={optionType === 'put' ? 'active put' : 'put'}
              onClick={() => { setOptionType('put'); setSelected(null); }}
            >
              PUT
            </button>
          </div>
        </div>

        <div className="view-tabs">
          <button type="button" className={view === 'best' ? 'active' : ''} onClick={() => setView('best')}>
            ⭐ Best OTM
          </button>
          <button type="button" className={view === 'chain' ? 'active' : ''} onClick={() => setView('chain')}>
            Full chain
          </button>
        </div>

        {view === 'chain' && (
          <div className="form-group">
            <label>Expiry Date</label>
            <select value={chainExpiry} onChange={(e) => setChainExpiry(e.target.value)} disabled={loading}>
              {expiryDates.map((date) => (
                <option key={date} value={date}>
                  {fmtExpiry(date)} ({Math.round(daysToExpiry(date))}d)
                </option>
              ))}
            </select>
          </div>
        )}

        {loading && Object.keys(chains).length === 0 ? (
          <div className="loading">Loading options chain...</div>
        ) : error && Object.keys(chains).length === 0 ? (
          <div className="no-data">{error}</div>
        ) : view === 'best' ? (
          ranked.length > 0 ? (
            <div className="best-list">
              <div className="best-note">
                Top out-of-the-money {optionType}s across the next few expiries, rated 0-100 on liquidity,
                delta, breakeven and time.
              </div>
              {ranked.map((r) => (
                <div
                  key={`${r.expiry}-${r.contract.strike}`}
                  className={`best-row ${isSelected(r.expiry, r.contract.strike) ? 'selected' : ''}`}
                  onClick={() => select(r.expiry, r.contract)}
                >
                  <span className={`grade grade-${r.grade}`} title={`Score ${r.score.toFixed(0)}/100`}>
                    {r.grade}
                    <small>{r.score.toFixed(0)}</small>
                  </span>
                  <div className="best-main">
                    <div className="best-title">
                      ${r.contract.strike.toFixed(2)} {optionType.toUpperCase()}
                      <span className="best-expiry">{fmtExpiry(r.expiry)} · {Math.round(r.dte)}d</span>
                    </div>
                    <div className="best-stats">
                      <span>Δ {r.delta.toFixed(2)}</span>
                      <span>Spread {(r.spreadPct * 100).toFixed(0)}%</span>
                      <span>B/E {(r.breakevenMove * 100).toFixed(1)}%</span>
                      <span>Vol {r.contract.volume.toLocaleString()}</span>
                      <span>OI {r.contract.openInterest.toLocaleString()}</span>
                    </div>
                  </div>
                  <span className="best-price">${r.mid.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-data">No liquid out-of-the-money {optionType}s found right now</div>
          )
        ) : chainRows.length > 0 ? (
          <div className="options-chain">
            <div className="chain-header">
              <span>Strike</span>
              <span>Last</span>
              <span>Bid/Ask</span>
              <span>Vol</span>
            </div>
            <div className="chain-list">
              {chainRows.map((option) => (
                <div
                  key={option.strike}
                  className={`chain-row ${isSelected(chainExpiry, option.strike) ? 'selected' : ''} ${option.inTheMoney ? 'itm' : 'otm'}`}
                  onClick={() => select(chainExpiry, option)}
                >
                  <span className="strike">${option.strike.toFixed(2)}</span>
                  <span className="last">${option.lastPrice.toFixed(2)}</span>
                  <span className="bid-ask">
                    ${option.bid.toFixed(2)}/${option.ask.toFixed(2)}
                  </span>
                  <span className="volume">{option.volume.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="no-data">No options data available</div>
        )}

        {selected && (
          <>
            <div className="selected-option-info">
              <h4>
                Selected Option
                {selectedRating && (
                  <span className={`grade grade-${selectedRating.grade} inline`}>{selectedRating.grade}</span>
                )}
              </h4>
              <div className="info-grid">
                <div>
                  <label>Strike:</label>
                  <span>${selected.option.strike.toFixed(2)}</span>
                </div>
                <div>
                  <label>Expiry:</label>
                  <span>{fmtExpiry(selected.expiry)}</span>
                </div>
                <div>
                  <label>Premium (mid):</label>
                  <span>${premium.toFixed(2)}</span>
                </div>
                <div>
                  <label>IV:</label>
                  <span>{(selected.option.impliedVolatility * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <label>OI:</label>
                  <span>{selected.option.openInterest.toLocaleString()}</span>
                </div>
                {selectedRating && (
                  <div>
                    <label>Breakeven:</label>
                    <span>
                      ${(optionType === 'call' ? selected.option.strike + premium : selected.option.strike - premium).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <OptionPnlEstimate
              side={optionType}
              spot={currentPrice}
              strike={selected.option.strike}
              premium={premium}
              contracts={parseInt(quantity) || 1}
              iv={selected.option.impliedVolatility}
              years={yearsToExpiry(selected.expiry)}
            />

            <div className="form-group">
              <label>Number of Contracts</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
                step="1"
                required
              />
            </div>

            <div className="option-summary">
              <div className="summary-row">
                <span>Current Price:</span>
                <span className="value">${currentPrice.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Total Cost:</span>
                <span className="value">${estimatedCost.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Available Balance:</span>
                <span className="value">${balance.toFixed(2)}</span>
              </div>
              <div className="summary-info">
                Each contract represents 100 shares. Filled at the bid/ask midpoint.
              </div>
            </div>

            <button
              type="submit"
              className={`submit-btn ${optionType}`}
              disabled={estimatedCost > balance}
            >
              Buy {optionType.toUpperCase()} Option
            </button>
          </>
        )}
      </form>
    </div>
  );
};
