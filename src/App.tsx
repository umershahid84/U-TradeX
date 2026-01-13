import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { TradingChart } from './components/TradingChart';
import { TradingPanel } from './components/TradingPanel';
import { Portfolio } from './components/Portfolio';
import { FearGreedIndicator } from './components/FearGreedIndicator';
import { TPSLPanel } from './components/TPSLPanel';
import { OptionsPanel } from './components/OptionsPanel';
import { usePaperTrading } from './hooks/usePaperTrading';
import { RealMarketDataService } from './services/realMarketData';
import {
  calculateFearGreed,
  calculateSMA,
  calculateRSI,
} from './utils/indicators';
import { TimeFrame, TimeRange, ChartData, FearGreedData, TakeProfitStopLoss } from './types';
import './App.css';

const marketData = RealMarketDataService.getInstance();

function App() {
  const [symbol, setSymbol] = useState(() => {
    return localStorage.getItem('lastViewedSymbol') || 'AAPL';
  });
  const [timeframe, setTimeframe] = useState<TimeFrame>('5m');
  const [timeRange, setTimeRange] = useState<TimeRange>('1D');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [fearGreedData, setFearGreedData] = useState<FearGreedData>({
    value: 50,
    level: 'neutral',
    signal: 'HOLD',
    oversold: false,
    overbought: false,
  });
  const [tpslSettings, setTpslSettings] = useState<Map<string, TakeProfitStopLoss>>(new Map());
  const [includeAfterHours, setIncludeAfterHours] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [showLeftSidebar, setShowLeftSidebar] = useState(() => {
    return localStorage.getItem('showLeftSidebar') !== 'false';
  });
  const [showRightSidebar, setShowRightSidebar] = useState(() => {
    return localStorage.getItem('showRightSidebar') !== 'false';
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

  // Load chart data when symbol or timeframe changes
  useEffect(() => {
    const loadData = async () => {
      setConnectionStatus('connecting');
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
    });

    return unsubscribe;
  }, [symbol, updatePositionPrices]);

  // Subscribe to price updates for all open positions
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    account.positions.forEach((position) => {
      // Skip if it's the current symbol (already subscribed above)
      if (position.symbol === symbol) return;

      const unsubscribe = marketData.subscribeToPrice(position.symbol, (price) => {
        updatePositionPrices(position.symbol, price);
        checkTPSL(position.symbol, price);
      });

      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [account.positions, symbol, updatePositionPrices]);

  // Calculate Fear & Greed indicator
  useEffect(() => {
    if (chartData.length < 50) return;

    const closes = chartData.map((d) => d.close);
    const volumes = chartData.map((d) => d.volume);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const rsi = calculateRSI(closes);
    
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVolume = volumes[volumes.length - 1];

    const fg = calculateFearGreed(
      currentPrice,
      sma20[sma20.length - 1] || currentPrice,
      sma50[sma50.length - 1] || currentPrice,
      rsi,
      lastVolume,
      avgVolume
    );

    setFearGreedData(fg);
  }, [chartData, currentPrice]);

  const checkTPSL = (symbol: string, price: number) => {
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
  };

  const handleSymbolChange = useCallback((newSymbol: string) => {
    setSymbol(newSymbol);
    localStorage.setItem('lastViewedSymbol', newSymbol);
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
    localStorage.setItem('showLeftSidebar', String(newValue));
  };

  const toggleRightSidebar = () => {
    const newValue = !showRightSidebar;
    setShowRightSidebar(newValue);
    localStorage.setItem('showRightSidebar', String(newValue));
  };

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
        {showLeftSidebar && (
          <div className="left-sidebar">
            <button className="sidebar-toggle left" onClick={toggleLeftSidebar} title="Hide sidebar">
              ◀
            </button>
            <Portfolio account={account} onReset={resetAccount} />
          </div>
        )}
        
        {!showLeftSidebar && (
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
            </div>
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
                   'Disconnected'}
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

        {showRightSidebar && (
          <div className="right-sidebar">
            <button className="sidebar-toggle right" onClick={toggleRightSidebar} title="Hide sidebar">
              ▶
            </button>
            <div className="sidebar-panels">
              <FearGreedIndicator data={fearGreedData} />
              
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
                onBuyOption={buyOption}
              />
            </div>
          </div>
        )}
        
        {!showRightSidebar && (
          <button className="sidebar-toggle-collapsed right" onClick={toggleRightSidebar} title="Show sidebar">
            ◀
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
