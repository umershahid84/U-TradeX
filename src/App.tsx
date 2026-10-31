import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { TradingChart } from './components/TradingChart';
import { TradingPanel } from './components/TradingPanel';
import { Portfolio } from './components/Portfolio';
import { FearGreedIndicator } from './components/FearGreedIndicator';
import { TPSLPanel } from './components/TPSLPanel';
import { OptionsPanel } from './components/OptionsPanel';
import { usePaperTrading } from './hooks/usePaperTrading';
import { RealMarketDataService, QuoteDetails } from './services/realMarketData';
import { Session, SESSION_COLOR, SESSION_LABEL, sessionAt } from './utils/marketSessions';
import {
  calculateFearGreed,
  calculateSMA,
  calculateRSI,
} from './utils/indicators';
import { TimeFrame, TimeRange, ChartData, FearGreedData, MarketFearGreed, TakeProfitStopLoss } from './types';
import './App.css';

const marketData = RealMarketDataService.getInstance();

const fmtMove = (change: number | null, pct: number | null) =>
  change === null || pct === null ? '' : `${change >= 0 ? '+' : '-'}${Math.abs(change).toFixed(2)} (${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%)`;

// Regular-session close and extended-hours moves, e.g. "At close $344.63 -4.28" then "After hours $345.10 +0.47"
const SessionMoves = ({ quote }: { quote: QuoteDetails | null }) => {
  if (!quote) return null;
  const rows: { key: string; label: string; icon: string; price: number | null; change: number | null; pct: number | null; color: string }[] = [
    { key: 'reg', label: quote.marketState === 'REGULAR' ? 'Market' : 'At close', icon: '', price: quote.regularPrice, change: quote.regularChange, pct: quote.regularChangePercent, color: SESSION_COLOR.regular },
    { key: 'pre', label: 'Pre-market', icon: '☀', price: quote.preMarketPrice, change: quote.preMarketChange, pct: quote.preMarketChangePercent, color: SESSION_COLOR.pre },
    { key: 'post', label: 'After hours', icon: '🌙', price: quote.postMarketPrice, change: quote.postMarketChange, pct: quote.postMarketChangePercent, color: SESSION_COLOR.post },
  ];
  // Pre-market belongs to the day ahead, after-hours to the day just finished: show only the live one
  const visible = rows.filter((r) => {
    if (r.price === null) return false;
    if (r.key === 'pre') return quote.marketState === 'PRE' || quote.marketState === 'PREPRE';
    if (r.key === 'post') return quote.marketState !== 'REGULAR' && quote.marketState !== 'PRE' && quote.marketState !== 'PREPRE';
    return true;
  });
  return (
    <div className="session-moves">
      {visible.map((r) => (
        <div key={r.key} className="session-move">
          <span className="sm-label" style={{ color: r.color }}>{r.icon} {r.label}</span>
          <span className="sm-price">${r.price!.toFixed(2)}</span>
          <span className={`sm-change ${(r.change ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtMove(r.change, r.pct)}</span>
        </div>
      ))}
    </div>
  );
};

const MOBILE_QUERY = '(max-width: 900px)';

// True on phone-sized screens, where the layout stacks into a single scrolling column
const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
};

// Length in ms of an intraday Yahoo interval; 0 for daily and above
const intradayIntervalMs = (interval: string): number => {
  const m = /^(\d+)(m|h)$/.exec(interval);
  if (!m) return 0;
  return Number(m[1]) * (m[2] === 'h' ? 3600000 : 60000);
};

const getStorageValue = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const setStorageValue = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Unable to persist ${key}`, error);
  }
};

function App() {
  const [symbol, setSymbol] = useState(() => {
    return getStorageValue('lastViewedSymbol', 'AAPL');
  });
  const [timeframe, setTimeframe] = useState<TimeFrame>('5m');
  const [timeRange, setTimeRange] = useState<TimeRange>('1D');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  // Sentiment of the charted symbol; null until there is enough data to read
  const [fearGreedData, setFearGreedData] = useState<FearGreedData | null>(null);
  const [marketFearGreed, setMarketFearGreed] = useState<MarketFearGreed | null>(null);
  const [marketFearGreedError, setMarketFearGreedError] = useState('');
  const [tpslSettings, setTpslSettings] = useState<Map<string, TakeProfitStopLoss>>(new Map());
  // On by default so pre-market and after-hours trading shows on the chart
  const [includeAfterHours, setIncludeAfterHours] = useState(true);
  const [quoteDetails, setQuoteDetails] = useState<QuoteDetails | null>(null);
  const [session, setSession] = useState<Session>(() => sessionAt(Date.now()));
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [dataError, setDataError] = useState<string>('');
  const isMobile = useIsMobile();
  const [showLeftSidebar, setShowLeftSidebar] = useState(() => {
    return getStorageValue('showLeftSidebar', 'true') !== 'false';
  });
  const [showRightSidebar, setShowRightSidebar] = useState(() => {
    return getStorageValue('showRightSidebar', 'true') !== 'false';
  });

  const {
    account,
    placeOrder,
    resetAccount,
    updatePositionPrices,
    buyOption,
  } = usePaperTrading();

  // Map TimeRange to Yahoo Finance range format
  const getYahooRange = (range: TimeRange): string => {
    const map: Record<TimeRange, string> = {
      '1D': '1d',
      '5D': '5d',
      '1M': '1mo',
      '3M': '3mo',
      '6M': '6mo',
      'YTD': 'ytd',
      '1Y': '1y',
      '5Y': '5y',
      'MAX': 'max',
    };
    return map[range] || '1d';
  };

  // Map TimeFrame to Yahoo Finance interval format
  const getYahooInterval = (tf: TimeFrame): string => {
    const map: Record<TimeFrame, string> = {
      '1s': '1m',  // Yahoo doesn't support seconds, use 1m as closest
      '5s': '1m',
      '10s': '1m',
      '30s': '1m',
      '1m': '1m',
      '2m': '2m',
      '5m': '5m',
      '10m': '15m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '1d',
      'D': '1d',
      'W': '1wk',
      'M': '1mo',
      '1Q': '3mo',
      '1Y': '3mo',
    };
    return map[tf] || '5m';
  };

  const checkTPSL = useCallback((symbol: string, price: number) => {
    const tpsl = tpslSettings.get(symbol);
    if (!tpsl) return;

    const position = account.positions.find((p) => p.symbol === symbol);
    if (!position) return;

    if (tpsl.takeProfit && price >= tpsl.takeProfit) {
      alert(`Take Profit triggered for ${symbol} at $${price.toFixed(2)}`);
      placeOrder({
        symbol,
        type: 'market',
        side: 'sell',
        quantity: position.quantity,
        price,
      });
      setTpslSettings((prev) => {
        const next = new Map(prev);
        next.delete(symbol);
        return next;
      });
    } else if (tpsl.stopLoss && price <= tpsl.stopLoss) {
      alert(`Stop Loss triggered for ${symbol} at $${price.toFixed(2)}`);
      placeOrder({
        symbol,
        type: 'market',
        side: 'sell',
        quantity: position.quantity,
        price,
      });
      setTpslSettings((prev) => {
        const next = new Map(prev);
        next.delete(symbol);
        return next;
      });
    }
  }, [account.positions, placeOrder, tpslSettings]);

  // Load chart data when symbol or timeframe changes
  useEffect(() => {
    const loadData = async () => {
      setConnectionStatus('connecting');
      setDataError('');
      setFearGreedData(null); // don't show the previous symbol's reading while loading
      const yahooRange = getYahooRange(timeRange);
      const yahooInterval = getYahooInterval(timeframe);
      
      try {
        const data = await marketData.fetchChartData(symbol, yahooInterval, yahooRange, includeAfterHours);
        setChartData(data);
        
        if (data.length > 0) {
          setCurrentPrice(data[data.length - 1].close);
          setConnectionStatus('connected');
        } else {
          // No data returned, but request succeeded
          setConnectionStatus('disconnected');
          console.warn('No chart data returned for symbol:', symbol);
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setDataError(error instanceof Error ? error.message : String(error));
        setConnectionStatus('disconnected');
      }
    };

    loadData();
  }, [symbol, timeframe, timeRange, includeAfterHours]);

  // Subscribe to live price updates for current symbol
  useEffect(() => {
    const unsubscribe = marketData.subscribeToPrice(symbol, (price) => {
      setCurrentPrice(price);
      
      // Update chart with new price
      setChartData((prevData) => {
        const newData = [...prevData];
        const lastBar = newData[newData.length - 1];

        // Start a new candle once the current bar's interval has elapsed
        const barMs = intradayIntervalMs(getYahooInterval(timeframe));
        if (lastBar && barMs && Date.now() >= lastBar.time + barMs && price !== lastBar.close) {
          const barTime = Math.floor(Date.now() / barMs) * barMs;
          if (barTime > lastBar.time) {
            newData.push({
              time: barTime,
              open: lastBar.close,
              high: Math.max(lastBar.close, price),
              low: Math.min(lastBar.close, price),
              close: price,
              volume: 0,
            });
            return newData;
          }
        }

        if (lastBar) {
          newData[newData.length - 1] = {
            ...lastBar,
            close: price,
            high: Math.max(lastBar.high, price),
            low: Math.min(lastBar.low, price),
          };
        }
        
        return newData;
      });

      // Update position prices for current symbol
      updatePositionPrices(symbol, price);

      // Check TP/SL
      checkTPSL(symbol, price);
    }, includeAfterHours);

    return unsubscribe;
  }, [symbol, timeframe, updatePositionPrices, includeAfterHours, checkTPSL]);

  // Subscribe to price updates for every other symbol we hold stock or options in.
  // Keyed by the symbol list (not the account objects, which change on every tick).
  const heldSymbols = [...new Set([
    ...account.positions.map((p) => p.symbol),
    ...account.options.map((o) => o.symbol),
  ])].filter((s) => s !== symbol).sort().join(',');

  useEffect(() => {
    if (!heldSymbols) return;
    const unsubscribers = heldSymbols.split(',').map((held) =>
      marketData.subscribeToPrice(held, (price) => {
        updatePositionPrices(held, price);
        checkTPSL(held, price);
      })
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [heldSymbols, updatePositionPrices, checkTPSL]);

  // Current trading session, and regular/extended-hours price moves for the header
  useEffect(() => {
    const tick = () => setSession(sessionAt(Date.now()));
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQuoteDetails(null);
    const load = async () => {
      try {
        const q = await marketData.getQuoteDetails(symbol);
        if (!cancelled) setQuoteDetails(q);
      } catch {
        /* header details are optional */
      }
    };
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  // Market-wide Fear & Greed (CNN's index), refreshed every few minutes
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fg = await marketData.getMarketFearGreed();
        if (!cancelled) {
          setMarketFearGreed(fg);
          setMarketFearGreedError('');
        }
      } catch (e) {
        if (!cancelled) setMarketFearGreedError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Per-symbol sentiment from the chart being viewed
  useEffect(() => {
    if (chartData.length < 50) {
      setFearGreedData(null);
      return;
    }

    const closes = chartData.map((d) => d.close);
    const volumes = chartData.map((d) => d.volume);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const rsi = calculateRSI(closes);

    // Compare the last bar that has a volume against the average, so a freshly opened live bar
    // (volume 0 so far) does not read as a collapse in volume
    const withVolume = volumes.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
    let volumeRatio: number | null = null;
    if (withVolume.length > 21) {
      const lastIdx = withVolume[withVolume.length - 1].i;
      const avg = withVolume.slice(-21, -1).reduce((a, b) => a + b.v, 0) / 20;
      volumeRatio = avg > 0 ? volumes[lastIdx] / avg : null;
    }

    setFearGreedData(
      calculateFearGreed(
        currentPrice || closes[closes.length - 1],
        sma20[sma20.length - 1] || closes[closes.length - 1],
        sma50[sma50.length - 1] || closes[closes.length - 1],
        rsi,
        volumeRatio,
        closes[closes.length - 1] - closes[closes.length - 2]
      )
    );
  }, [chartData, currentPrice]);

  const handleSymbolChange = useCallback((newSymbol: string) => {
    setSymbol(newSymbol);
    setStorageValue('lastViewedSymbol', newSymbol);
  }, []);

  const handleTimeframeChange = useCallback((tf: TimeFrame) => {
    setTimeframe(tf);
  }, []);

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  const handleTPSLSet = (tpsl: TakeProfitStopLoss) => {
    setTpslSettings((prev) => new Map(prev).set(tpsl.symbol, tpsl));
    alert(`TP/SL set for ${tpsl.symbol}`);
  };

  const toggleLeftSidebar = () => {
    const newValue = !showLeftSidebar;
    setShowLeftSidebar(newValue);
    setStorageValue('showLeftSidebar', String(newValue));
  };

  const toggleRightSidebar = () => {
    const newValue = !showRightSidebar;
    setShowRightSidebar(newValue);
    setStorageValue('showRightSidebar', String(newValue));
  };

  // On mobile the panels stack below the chart, so the collapse toggles don't apply
  const leftVisible = showLeftSidebar || isMobile;
  const rightVisible = showRightSidebar || isMobile;

  return (
    <div className="app">
      <Navbar
        symbol={symbol}
        timeframe={timeframe}
        timeRange={timeRange}
        onSymbolChange={handleSymbolChange}
        onTimeframeChange={handleTimeframeChange}
        onTimeRangeChange={handleTimeRangeChange}
      />
      
      <div className="main-content">
        {leftVisible && (
          <div className="left-sidebar">
            <button className="sidebar-toggle left" onClick={toggleLeftSidebar} title="Hide sidebar">
              ◀
            </button>
            <Portfolio account={account} onReset={resetAccount} />
          </div>
        )}
        
        {!leftVisible && (
          <button className="sidebar-toggle-collapsed left" onClick={toggleLeftSidebar} title="Show sidebar">
            ▶
          </button>
        )}

        <div className="chart-area">
          <div className="chart-header">
            <div className="symbol-info">
              <h2>{symbol}</h2>
              <div className="price-display">
                <span className="current-price">${currentPrice.toFixed(2)}</span>
              </div>
              <span className="session-badge" style={{ color: SESSION_COLOR[session], borderColor: SESSION_COLOR[session] }}>
                <i style={{ background: SESSION_COLOR[session] }} />
                {SESSION_LABEL[session]}
              </span>
            </div>
            <SessionMoves quote={quoteDetails} />
            <div className="bid-ask-display">
              <div className="bid-price">
                <span className="label">BID:</span>
                <span className="value">${(currentPrice * 0.9995).toFixed(2)}</span>
              </div>
              <div className="ask-price">
                <span className="label">ASK:</span>
                <span className="value">${(currentPrice * 1.0005).toFixed(2)}</span>
              </div>
              <div className="after-hours-toggle">
                <label>
                  <input
                    type="checkbox"
                    checked={includeAfterHours}
                    onChange={(e) => setIncludeAfterHours(e.target.checked)}
                  />
                  <span>After Hours</span>
                </label>
              </div>
              <div className={`connection-status ${connectionStatus}`}>
                <span className="status-dot"></span>
                <span className="status-text">
                  {connectionStatus === 'connected' ? 'Live' : 
                   connectionStatus === 'connecting' ? 'Connecting...' : 
                   `Disconnected${dataError ? ` - ${dataError}` : ''}`}
                </span>
              </div>
            </div>
          </div>
          
          <TradingChart
            symbol={symbol}
            timeframe={timeframe}
            data={chartData}
            onPriceUpdate={setCurrentPrice}
          />
        </div>

        {rightVisible && (
          <div className="right-sidebar">
            <button className="sidebar-toggle right" onClick={toggleRightSidebar} title="Hide sidebar">
              ▶
            </button>
            <div className="sidebar-panels">
              <FearGreedIndicator
                symbol={symbol}
                market={marketFearGreed}
                marketError={marketFearGreedError}
                ticker={fearGreedData}
              />
              
              <TradingPanel
                symbol={symbol}
                currentPrice={currentPrice}
                balance={account.balance}
                onPlaceOrder={placeOrder}
              />

              <TPSLPanel
                positions={account.positions}
                onSet={handleTPSLSet}
              />

              <OptionsPanel
                symbol={symbol}
                currentPrice={currentPrice}
                balance={account.balance}
                chartData={chartData}
                chartLabel={`${timeframe} · ${timeRange}`}
                onBuyOption={buyOption}
              />
            </div>
          </div>
        )}
        
        {!rightVisible && (
          <button className="sidebar-toggle-collapsed right" onClick={toggleRightSidebar} title="Show sidebar">
            ◀
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
