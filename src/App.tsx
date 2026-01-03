import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { TradingChart } from './components/TradingChart';
import { TradingPanel } from './components/TradingPanel';
import { Portfolio } from './components/Portfolio';
import { FearGreedIndicator } from './components/FearGreedIndicator';
import { TPSLPanel } from './components/TPSLPanel';
import { OptionsPanel } from './components/OptionsPanel';
import { usePaperTrading } from './hooks/usePaperTrading';
import { MarketDataService } from './services/marketData';
import {
  calculateFearGreed,
  calculateSMA,
  calculateRSI,
} from './utils/indicators';
import { TimeFrame, TimeRange, ChartData, FearGreedData, TakeProfitStopLoss } from './types';
import './App.css';

const marketData = MarketDataService.getInstance();

function App() {
  const [symbol, setSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState<TimeFrame>('5m');
  const [timeRange, setTimeRange] = useState<TimeRange>('1d');
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

  const {
    account,
    placeOrder,
    resetAccount,
    updatePositionPrices,
    buyOption,
  } = usePaperTrading();

  // Calculate number of bars based on time range
  const getBarsCount = (range: TimeRange): number => {
    const counts: Record<TimeRange, number> = {
      today: 100,
      '1d': 100,
      '5d': 200,
      '1w': 300,
      '1y': 365,
      max: 1000,
    };
    return counts[range];
  };

  // Load chart data when symbol or timeframe changes
  useEffect(() => {
    const bars = getBarsCount(timeRange);
    const data = marketData.generateChartData(symbol, timeframe, bars);
    setChartData(data);
    
    if (data.length > 0) {
      setCurrentPrice(data[data.length - 1].close);
    }
  }, [symbol, timeframe, timeRange]);

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
        <div className="left-sidebar">
          <Portfolio account={account} onReset={resetAccount} />
        </div>

        <div className="chart-area">
          <div className="chart-header">
            <div className="symbol-info">
              <h2>{symbol}</h2>
              <div className="price-display">
                <span className="current-price">${currentPrice.toFixed(2)}</span>
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

        <div className="right-sidebar">
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
      </div>
    </div>
  );
}

export default App;
