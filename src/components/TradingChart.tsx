import React, { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickData, 
  Time, 
  LineData,
  CandlestickSeries,
  LineSeries
} from 'lightweight-charts';
import { ChartData, TimeFrame } from '../types';
import { calculateRipsterEMACloud, calculateSMA, calculateVWAP, calculateBollingerBands } from '../utils/indicators';
import { DrawingTools, DrawingTool } from './DrawingTools';
import './TradingChart.css';

interface TradingChartProps {
  symbol: string;
  timeframe: TimeFrame;
  data: ChartData[];
  onPriceUpdate?: (price: number) => void;
}

interface IndicatorState {
  ema5: boolean;
  ema8: boolean;
  ema9: boolean;
  ema13: boolean;
  sma20: boolean;
  sma50: boolean;
  vwap: boolean;
  rsi: boolean;
  bb: boolean;
  volume: boolean;
}

interface DrawingObject {
  id: string;
  type: DrawingTool;
  series?: ISeriesApi<'Line'>;
  data: LineData[];
}

export const TradingChart: React.FC<TradingChartProps> = ({
  data,
  onPriceUpdate,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null) as any;
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const drawingsRef = useRef<DrawingObject[]>([]);
  const [showIndicators, setShowIndicators] = useState(false);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>('none');
  const [indicators, setIndicators] = useState<IndicatorState>({
    ema5: true,
    ema8: true,
    ema9: true,
    ema13: true,
    sma20: true,
    sma50: true,
    vwap: false,
    rsi: false,
    bb: false,
    volume: false,
  });
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0a0e27' },
        textColor: '#e0e0e0',
      },
      grid: {
        vertLines: { color: '#1a1e3f' },
        horzLines: { color: '#1a1e3f' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a2e4f',
        rightOffset: 10,
        barSpacing: 6,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      rightPriceScale: {
        borderColor: '#2a2e4f',
      },
      crosshair: {
        mode: 1,
      },
    });

    chartRef.current = chart;

    // Create candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    candleSeriesRef.current = candleSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !data.length) return;

    // Convert data to lightweight-charts format
    const chartData: CandlestickData[] = data.map(d => ({
      time: (d.time / 1000) as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    candleSeriesRef.current.setData(chartData);

    // Notify parent of latest price
    if (onPriceUpdate && data.length > 0) {
      onPriceUpdate(data[data.length - 1].close);
    }

    // Fit content only on initial load
    if (isInitialLoadRef.current && data.length > 0) {
      chartRef.current?.timeScale().fitContent();
      isInitialLoadRef.current = false;
    }
  }, [data, onPriceUpdate]);

  // Separate effect for managing indicators
  useEffect(() => {
    if (!chartRef.current || !data.length) return;

    // Remove all existing indicator series
    indicatorSeriesRef.current.forEach((series) => {
      chartRef.current?.removeSeries(series);
    });
    indicatorSeriesRef.current.clear();

    // Add indicators based on selection
    if (showIndicators) {
      const closes = data.map(d => d.close);
      const emaCloud = calculateRipsterEMACloud(closes);

      // Add EMA 5
      if (indicators.ema5) {
        const ema5Series = chartRef.current.addSeries(LineSeries, {
          color: '#2196F3',
          lineWidth: 1,
          title: 'EMA 5',
        });
        const ema5Data: LineData[] = emaCloud.ema5.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema5Series.setData(ema5Data);
        indicatorSeriesRef.current.set('ema5', ema5Series);
      }

      // Add EMA 8
      if (indicators.ema8) {
        const ema8Series = chartRef.current.addSeries(LineSeries, {
          color: '#00BCD4',
          lineWidth: 1,
          title: 'EMA 8',
        });
        const ema8Data: LineData[] = emaCloud.ema8.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema8Series.setData(ema8Data);
        indicatorSeriesRef.current.set('ema8', ema8Series);
      }

      // Add EMA 9
      if (indicators.ema9) {
        const ema9Series = chartRef.current.addSeries(LineSeries, {
          color: '#009688',
          lineWidth: 1,
          title: 'EMA 9',
        });
        const ema9Data: LineData[] = emaCloud.ema9.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema9Series.setData(ema9Data);
        indicatorSeriesRef.current.set('ema9', ema9Series);
      }

      // Add EMA 13
      if (indicators.ema13) {
        const ema13Series = chartRef.current.addSeries(LineSeries, {
          color: '#4CAF50',
          lineWidth: 1,
          title: 'EMA 13',
        });
        const ema13Data: LineData[] = emaCloud.ema13.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema13Series.setData(ema13Data);
        indicatorSeriesRef.current.set('ema13', ema13Series);
      }

      // Add SMA 20
      if (indicators.sma20) {
        const sma20 = calculateSMA(closes, 20);
        const sma20Series = chartRef.current.addSeries(LineSeries, {
          color: '#FFC107',
          lineWidth: 2,
          title: 'SMA 20',
        });
        const sma20Data: LineData[] = sma20.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        sma20Series.setData(sma20Data);
        indicatorSeriesRef.current.set('sma20', sma20Series);
      }

      // Add SMA 50
      if (indicators.sma50) {
        const sma50 = calculateSMA(closes, 50);
        const sma50Series = chartRef.current.addSeries(LineSeries, {
          color: '#FF9800',
          lineWidth: 2,
          title: 'SMA 50',
        });
        const sma50Data: LineData[] = sma50.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        sma50Series.setData(sma50Data);
        indicatorSeriesRef.current.set('sma50', sma50Series);
      }

      // Add VWAP
      if (indicators.vwap) {
        const vwapData = calculateVWAP(data);
        const vwapSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          title: 'VWAP',
        });
        const vwapLineData: LineData[] = vwapData.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value,
        }));
        vwapSeries.setData(vwapLineData);
        indicatorSeriesRef.current.set('vwap', vwapSeries);
      }

      // Add Bollinger Bands
      if (indicators.bb) {
        const bb = calculateBollingerBands(closes, 20, 2);
        
        const bbUpperSeries = chartRef.current.addSeries(LineSeries, {
          color: '#E91E63',
          lineWidth: 1,
          title: 'BB Upper',
        });
        const bbUpperData: LineData[] = bb.upper.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        bbUpperSeries.setData(bbUpperData);
        indicatorSeriesRef.current.set('bbUpper', bbUpperSeries);

        const bbMiddleSeries = chartRef.current.addSeries(LineSeries, {
          color: '#F06292',
          lineWidth: 1,
          title: 'BB Middle',
        });
        const bbMiddleData: LineData[] = bb.middle.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        bbMiddleSeries.setData(bbMiddleData);
        indicatorSeriesRef.current.set('bbMiddle', bbMiddleSeries);

        const bbLowerSeries = chartRef.current.addSeries(LineSeries, {
          color: '#E91E63',
          lineWidth: 1,
          title: 'BB Lower',
        });
        const bbLowerData: LineData[] = bb.lower.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        bbLowerSeries.setData(bbLowerData);
        indicatorSeriesRef.current.set('bbLower', bbLowerSeries);
      }
    }
  }, [data, showIndicators, indicators]);

  const handleToolSelect = (tool: DrawingTool) => {
    setSelectedTool(tool);
    if (tool !== 'none') {
      alert(`Drawing tool selected: ${tool}. Click on the chart to add drawing points. Feature in development - basic price lines will be added.`);
    }
  };

  const handleClearAllDrawings = () => {
    // Remove all drawing series from the chart
    drawingsRef.current.forEach((drawing) => {
      if (drawing.series && chartRef.current) {
        chartRef.current.removeSeries(drawing.series);
      }
    });
    drawingsRef.current = [];
    setSelectedTool('none');
  };

  const addFibonacciLevels = () => {
    if (!chartRef.current || data.length === 0) return;

    // Calculate Fibonacci levels based on recent price action
    const recentData = data.slice(-50); // Last 50 bars
    const high = Math.max(...recentData.map(d => d.high));
    const low = Math.min(...recentData.map(d => d.low));
    const diff = high - low;

    const fibLevels = [
      { ratio: 0, level: high, label: '0%' },
      { ratio: 0.236, level: high - diff * 0.236, label: '23.6%' },
      { ratio: 0.382, level: high - diff * 0.382, label: '38.2%' },
      { ratio: 0.5, level: high - diff * 0.5, label: '50%' },
      { ratio: 0.618, level: high - diff * 0.618, label: '61.8%' },
      { ratio: 0.786, level: high - diff * 0.786, label: '78.6%' },
      { ratio: 1, level: low, label: '100%' },
    ];

    const colors = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#009688'];

    fibLevels.forEach((fib, index) => {
      const fibSeries = chartRef.current!.addSeries(LineSeries, {
        color: colors[index],
        lineWidth: 1,
        lineStyle: 2, // Dashed line
        title: `Fib ${fib.label}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      const fibData: LineData[] = recentData.map((d) => ({
        time: (d.time / 1000) as Time,
        value: fib.level,
      }));

      fibSeries.setData(fibData);

      drawingsRef.current.push({
        id: `fib-${index}`,
        type: 'fibonacci',
        series: fibSeries,
        data: fibData,
      });
    });
  };

  const toggleIndicator = (key: keyof IndicatorState) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="trading-chart-container">
      <DrawingTools
        selectedTool={selectedTool}
        onToolSelect={handleToolSelect}
        onClearAll={handleClearAllDrawings}
      />
      
      <div className="chart-controls">
        <button
          className="indicator-toggle"
          onClick={() => setShowIndicators(!showIndicators)}
        >
          {showIndicators ? '📊 Hide All Indicators' : '📊 Show Indicators'}
        </button>
        <button
          className="fibonacci-btn"
          onClick={addFibonacciLevels}
        >
          🔢 Add Fibonacci
        </button>
        {showIndicators && (
          <div className="indicator-checkboxes">
            <label>
              <input
                type="checkbox"
                checked={indicators.ema5}
                onChange={() => toggleIndicator('ema5')}
              />
              EMA 5
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.ema8}
                onChange={() => toggleIndicator('ema8')}
              />
              EMA 8
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.ema9}
                onChange={() => toggleIndicator('ema9')}
              />
              EMA 9
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.ema13}
                onChange={() => toggleIndicator('ema13')}
              />
              EMA 13
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.sma20}
                onChange={() => toggleIndicator('sma20')}
              />
              SMA 20
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.sma50}
                onChange={() => toggleIndicator('sma50')}
              />
              SMA 50
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.vwap}
                onChange={() => toggleIndicator('vwap')}
              />
              VWAP
            </label>
            <label>
              <input
                type="checkbox"
                checked={indicators.bb}
                onChange={() => toggleIndicator('bb')}
              />
              Bollinger Bands
            </label>
          </div>
        )}
      </div>
      <div ref={chartContainerRef} className="chart" />
    </div>
  );
};
