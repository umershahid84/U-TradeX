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
  sma100: boolean;
  sma200: boolean;
  vwap: boolean;
  rsi: boolean;
  macd: boolean;
  bb: boolean;
  volume: boolean;
}

interface DrawingObject {
  id: string;
  type: DrawingTool;
  series?: ISeriesApi<'Line'>;
  data: LineData[];
  startPoint?: { time: Time; price: number };
  endPoint?: { time: Time; price: number };
}

export const TradingChart: React.FC<TradingChartProps> = ({
  symbol,
  data,
  onPriceUpdate,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null) as any;
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const drawingsRef = useRef<DrawingObject[]>([]);
  const drawingStateRef = useRef<{
    isDrawing: boolean;
    startPoint: { time: Time; price: number } | null;
  }>({
    isDrawing: false,
    startPoint: null,
  });
  const selectedToolRef = useRef<DrawingTool>('none');
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showFibonacci, setShowFibonacci] = useState(false);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>('none');
  const [indicators, setIndicators] = useState<IndicatorState>({
    ema5: true,
    ema8: true,
    ema9: true,
    ema13: true,
    sma20: true,
    sma50: true,
    sma100: false,
    sma200: false,
    vwap: false,
    rsi: false,
    macd: false,
    bb: false,
    volume: true,
  });

  const handleChartClick = (time: Time, price: number) => {
    // Validate inputs
    if (!time || !price || isNaN(price)) return;
    if (selectedToolRef.current === 'none') return;

    if (!drawingStateRef.current.isDrawing) {
      // First click - start drawing
      drawingStateRef.current = {
        isDrawing: true,
        startPoint: { time, price },
      };
      setIsDrawingMode(true);
    } else {
      // Second click - finish drawing
      const startPoint = drawingStateRef.current.startPoint;
      if (!startPoint) return;

      const endPoint = { time, price };
      createDrawing(selectedToolRef.current, startPoint, endPoint);

      // Reset drawing state
      drawingStateRef.current = {
        isDrawing: false,
        startPoint: null,
      };
      setIsDrawingMode(false);
      
      // Reset tool to cursor after drawing
      setSelectedTool('none');
      selectedToolRef.current = 'none';
    }
  };

  const createDrawing = (
    type: DrawingTool,
    startPoint: { time: Time; price: number },
    endPoint: { time: Time; price: number }
  ) => {
    if (!chartRef.current) return;

    const drawingId = `${type}-${Date.now()}`;
    let series: ISeriesApi<'Line'> | undefined;
    let lineData: LineData[] = [];

    switch (type) {
      case 'trendline':
        // Create a trend line between two points
        series = chartRef.current.addSeries(LineSeries, {
          color: '#2196F3',
          lineWidth: 2,
          title: 'Trend Line',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        lineData = [
          { time: startPoint.time, value: startPoint.price },
          { time: endPoint.time, value: endPoint.price },
        ];
        series.setData(lineData);
        break;

      case 'horizontal':
        // Create a horizontal line at the clicked price
        series = chartRef.current.addSeries(LineSeries, {
          color: '#FFC107',
          lineWidth: 2,
          lineStyle: 2, // Dashed
          title: 'H-Line',
          priceLineVisible: true,
          lastValueVisible: true,
        });
        
        // Use all available data points for horizontal line
        const minTime = Math.min(Number(startPoint.time), Number(endPoint.time));
        const maxTime = Math.max(Number(startPoint.time), Number(endPoint.time));
        
        lineData = [
          { time: minTime as Time, value: startPoint.price },
          { time: maxTime as Time, value: startPoint.price },
        ];
        series.setData(lineData);
        break;

      case 'rectangle':
        // Create a rectangle using 4 lines
        const rectMinTime = Math.min(Number(startPoint.time), Number(endPoint.time));
        const rectMaxTime = Math.max(Number(startPoint.time), Number(endPoint.time));
        const rectMinPrice = Math.min(startPoint.price, endPoint.price);
        const rectMaxPrice = Math.max(startPoint.price, endPoint.price);

        // Top line
        const topSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          title: 'Rectangle',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        topSeries.setData([
          { time: rectMinTime as Time, value: rectMaxPrice },
          { time: rectMaxTime as Time, value: rectMaxPrice },
        ]);

        // Bottom line
        const bottomSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        bottomSeries.setData([
          { time: rectMinTime as Time, value: rectMinPrice },
          { time: rectMaxTime as Time, value: rectMinPrice },
        ]);

        // Left line
        const leftSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        leftSeries.setData([
          { time: rectMinTime as Time, value: rectMinPrice },
          { time: rectMinTime as Time, value: rectMaxPrice },
        ]);

        // Right line
        const rightSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        rightSeries.setData([
          { time: rectMaxTime as Time, value: rectMinPrice },
          { time: rectMaxTime as Time, value: rectMaxPrice },
        ]);

        // Store all rectangle parts as separate drawings
        drawingsRef.current.push(
          { id: `${drawingId}-top`, type: 'rectangle', series: topSeries, data: [], startPoint, endPoint },
          { id: `${drawingId}-bottom`, type: 'rectangle', series: bottomSeries, data: [], startPoint, endPoint },
          { id: `${drawingId}-left`, type: 'rectangle', series: leftSeries, data: [], startPoint, endPoint },
          { id: `${drawingId}-right`, type: 'rectangle', series: rightSeries, data: [], startPoint, endPoint }
        );
        return; // Early return since we already added to drawingsRef

      default:
        return;
    }

    if (series) {
      drawingsRef.current.push({
        id: drawingId,
        type,
        series,
        data: lineData,
        startPoint,
        endPoint,
      });
    }
  };

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

    // Add click handler for drawing tools
    chart.subscribeClick((param) => {
      if (!param.time || !param.point) return;
      
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (!price) return;

      handleChartClick(param.time as Time, price as number);
    });

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
  }, [data, onPriceUpdate]);

  // Separate effect for fitting content when symbol changes
  useEffect(() => {
    if (chartRef.current && data.length > 0) {
      // Use a small delay to ensure chart has rendered
      const timeoutId = setTimeout(() => {
        chartRef.current?.timeScale().fitContent();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [symbol, data.length]);

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

      // Add SMA 100
      if (indicators.sma100) {
        const sma100 = calculateSMA(closes, 100);
        const sma100Series = chartRef.current.addSeries(LineSeries, {
          color: '#FF5722',
          lineWidth: 2,
          title: 'SMA 100',
        });
        const sma100Data: LineData[] = sma100.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        sma100Series.setData(sma100Data);
        indicatorSeriesRef.current.set('sma100', sma100Series);
      }

      // Add SMA 200
      if (indicators.sma200) {
        const sma200 = calculateSMA(closes, 200);
        const sma200Series = chartRef.current.addSeries(LineSeries, {
          color: '#F44336',
          lineWidth: 3,
          title: 'SMA 200',
        });
        const sma200Data: LineData[] = sma200.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        sma200Series.setData(sma200Data);
        indicatorSeriesRef.current.set('sma200', sma200Series);
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
    selectedToolRef.current = tool;
    // Reset drawing state when changing tools
    drawingStateRef.current = {
      isDrawing: false,
      startPoint: null,
    };
    setIsDrawingMode(false);
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
    selectedToolRef.current = 'none';
  };

  const addFibonacciLevels = () => {
    if (!chartRef.current || data.length === 0) return;

    // If already showing, remove them (toggle off)
    if (showFibonacci) {
      removeFibonacciLevels();
      setShowFibonacci(false);
      return;
    }

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

    // Safely add Fibonacci levels with proper null checks
    if (!chartRef.current) return;

    fibLevels.forEach((fib, index) => {
      if (!chartRef.current) return; // Check again in loop
      
      const fibSeries = chartRef.current.addSeries(LineSeries, {
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
    
    setShowFibonacci(true);
  };

  const removeFibonacciLevels = () => {
    // Remove only Fibonacci drawings
    const fibDrawings = drawingsRef.current.filter(d => d.type === 'fibonacci');
    fibDrawings.forEach((drawing) => {
      if (drawing.series && chartRef.current) {
        chartRef.current.removeSeries(drawing.series);
      }
    });
    // Keep only non-fibonacci drawings
    drawingsRef.current = drawingsRef.current.filter(d => d.type !== 'fibonacci');
  };

  const toggleIndicator = (key: keyof IndicatorState) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="trading-chart-container">
      {isDrawingMode && (
        <div className="drawing-mode-indicator">
          Click on chart to complete {selectedTool}
        </div>
      )}
      
      <div className="chart-top-controls">
        <DrawingTools
          selectedTool={selectedTool}
          onToolSelect={handleToolSelect}
          onClearAll={handleClearAllDrawings}
        />
        
        <div className="chart-control-buttons">
          <div className="button-row">
            <button
              className={`fibonacci-btn ${showFibonacci ? 'active' : ''}`}
              onClick={addFibonacciLevels}
            >
              🔢 {showFibonacci ? 'Hide' : 'Add'} Fibonacci
            </button>
            
            <button
              className="indicator-toggle"
              onClick={() => setShowIndicators(!showIndicators)}
            >
              {showIndicators ? '📊 Hide Indicators' : '📊 Show Indicators'}
            </button>
          </div>
        </div>
      </div>
      
      {showIndicators && (
        <div className="indicator-panel">
          <div className="indicator-checkboxes">
            <div className="indicator-group">
              <h4>EMAs</h4>
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
            </div>
            
            <div className="indicator-group">
              <h4>SMAs</h4>
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
                  checked={indicators.sma100}
                  onChange={() => toggleIndicator('sma100')}
                />
                SMA 100
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.sma200}
                  onChange={() => toggleIndicator('sma200')}
                />
                SMA 200
              </label>
            </div>
            
            <div className="indicator-group">
              <h4>Others</h4>
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
              <label>
                <input
                  type="checkbox"
                  checked={indicators.rsi}
                  onChange={() => toggleIndicator('rsi')}
                />
                RSI (Panel)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.macd}
                  onChange={() => toggleIndicator('macd')}
                />
                MACD (Panel)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.volume}
                  onChange={() => toggleIndicator('volume')}
                />
                Volume
              </label>
            </div>
          </div>
        </div>
      )}
      
      <div ref={chartContainerRef} className="chart" />
    </div>
  );
};
