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
import { calculateRipsterEMACloud, calculateRipsterTrend, calculateSMA, calculateVWAP, calculateBollingerBands, calculateMTFClouds } from '../utils/indicators';
import { DrawingTools, DrawingTool } from './DrawingTools';
import { IndicatorPanels } from './IndicatorPanels';
import { CustomIndicatorPanel, CustomIndicator } from './CustomIndicatorPanel';
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
  ema34: boolean;
  ema50: boolean;
  ema72: boolean;
  sma20: boolean;
  sma50: boolean;
  sma100: boolean;
  sma200: boolean;
  vwap: boolean;
  rsi: boolean;
  macd: boolean;
  bb: boolean;
  volume: boolean;
  ripsterCloud: boolean;
  mtfClouds: boolean;
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
  const dataRef = useRef<ChartData[]>([]);
  // selectedToolRef: Tracks the current tool selection for the click handler.
  // We need both ref and state because:
  // - The ref is used in the chart click handler (set up once in useEffect with empty deps)
  //   to avoid stale closures
  // - The state is used for React re-renders to update the UI
  const selectedToolRef = useRef<DrawingTool>('none');
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showFibonacci, setShowFibonacci] = useState(false);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>('none');
  const [ripsterTrend, setRipsterTrend] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [customIndicators, setCustomIndicators] = useState<CustomIndicator[]>([]);
  const [indicators, setIndicators] = useState<IndicatorState>({
    ema5: false,
    ema8: false,
    ema9: false,
    ema13: false,
    ema34: false,
    ema50: false,
    ema72: false,
    sma20: false,
    sma50: false,
    sma100: false,
    sma200: false,
    vwap: false,
    rsi: false,
    macd: false,
    bb: false,
    volume: true,
    ripsterCloud: false,
    mtfClouds: false,
  });

  // Update dataRef whenever data changes
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const handleChartClick = (time: Time, price: number) => {
    // Validate inputs
    if (!time || !price || isNaN(price)) return;
    if (selectedToolRef.current === 'none') return;

    // Special case: horizontal line only needs one click
    if (selectedToolRef.current === 'horizontal') {
      // Get time range for the line
      const currentData = dataRef.current;
      if (!currentData || currentData.length === 0) return;
      const startTime = currentData[0].time / 1000;
      const endTime = currentData[currentData.length - 1].time / 1000;
      
      createDrawing(
        'horizontal',
        { time: startTime as Time, price },
        { time: endTime as Time, price }
      );
      
      // Reset tool to cursor after drawing
      setSelectedTool('none');
      selectedToolRef.current = 'none';
      return;
    }

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

        // Get all data points within the time range for better rendering
        const timeStep = (rectMaxTime - rectMinTime) / 10; // 10 segments for smooth lines
        
        // Top line
        const topSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          title: 'Rectangle',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const topLineData: LineData[] = [];
        for (let i = 0; i <= 10; i++) {
          topLineData.push({
            time: (rectMinTime + i * timeStep) as Time,
            value: rectMaxPrice,
          });
        }
        topSeries.setData(topLineData);

        // Bottom line
        const bottomSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const bottomLineData: LineData[] = [];
        for (let i = 0; i <= 10; i++) {
          bottomLineData.push({
            time: (rectMinTime + i * timeStep) as Time,
            value: rectMinPrice,
          });
        }
        bottomSeries.setData(bottomLineData);

        // Left line - need multiple time points to show as vertical
        const leftSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const priceStep = (rectMaxPrice - rectMinPrice) / 10;
        const leftLineData: LineData[] = [];
        for (let i = 0; i <= 10; i++) {
          leftLineData.push({
            time: rectMinTime as Time,
            value: rectMinPrice + i * priceStep,
          });
        }
        leftSeries.setData(leftLineData);

        // Right line
        const rightSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const rightLineData: LineData[] = [];
        for (let i = 0; i <= 10; i++) {
          rightLineData.push({
            time: rectMaxTime as Time,
            value: rectMinPrice + i * priceStep,
          });
        }
        rightSeries.setData(rightLineData);

        // Store all rectangle parts as separate drawings
        drawingsRef.current.push(
          { id: `${drawingId}-top`, type: 'rectangle', series: topSeries, data: topLineData, startPoint, endPoint },
          { id: `${drawingId}-bottom`, type: 'rectangle', series: bottomSeries, data: bottomLineData, startPoint, endPoint },
          { id: `${drawingId}-left`, type: 'rectangle', series: leftSeries, data: leftLineData, startPoint, endPoint },
          { id: `${drawingId}-right`, type: 'rectangle', series: rightSeries, data: rightLineData, startPoint, endPoint }
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

    // Use ResizeObserver for better responsiveness
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartContainerRef.current) {
        resizeObserver.unobserve(chartContainerRef.current);
      }
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

      // Add MTF Clouds (EMA 34, 50, 72)
      if (indicators.mtfClouds) {
        const mtfClouds = calculateMTFClouds(closes);
        
        const ema34Series = chartRef.current.addSeries(LineSeries, {
          color: '#00BCD4',
          lineWidth: 2,
          title: 'EMA 34',
        });
        const ema34Data: LineData[] = mtfClouds.ema34.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema34Series.setData(ema34Data);
        indicatorSeriesRef.current.set('ema34', ema34Series);

        const ema50Series = chartRef.current.addSeries(LineSeries, {
          color: '#03A9F4',
          lineWidth: 2,
          title: 'EMA 50',
        });
        const ema50Data: LineData[] = mtfClouds.ema50.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema50Series.setData(ema50Data);
        indicatorSeriesRef.current.set('ema50', ema50Series);

        const ema72Series = chartRef.current.addSeries(LineSeries, {
          color: '#0288D1',
          lineWidth: 2,
          title: 'EMA 72',
        });
        const ema72Data: LineData[] = mtfClouds.ema72.map((value, i) => ({
          time: (data[i].time / 1000) as Time,
          value: value || data[i].close,
        }));
        ema72Series.setData(ema72Data);
        indicatorSeriesRef.current.set('ema72', ema72Series);
      }
    }
  }, [data, showIndicators, indicators]);

  // Calculate Ripster Trend
  useEffect(() => {
    if (!data.length || !showIndicators) return;
    
    const closes = data.map(d => d.close);
    const emaCloud = calculateRipsterEMACloud(closes);
    
    if (data.length > 0 && emaCloud.ema5.length > 0) {
      const lastIndex = data.length - 1;
      const currentPrice = data[lastIndex].close;
      const ema5 = emaCloud.ema5[lastIndex];
      const ema8 = emaCloud.ema8[lastIndex];
      const ema9 = emaCloud.ema9[lastIndex];
      const ema13 = emaCloud.ema13[lastIndex];
      
      if (!isNaN(ema5) && !isNaN(ema8) && !isNaN(ema9) && !isNaN(ema13)) {
        const trend = calculateRipsterTrend(currentPrice, ema5, ema8, ema9, ema13);
        setRipsterTrend(trend);
      }
    }
  }, [data, showIndicators]);

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

  const handleAddCustomIndicator = (indicator: CustomIndicator) => {
    setCustomIndicators(prev => [...prev, indicator]);
  };

  const handleRemoveCustomIndicator = (id: string) => {
    setCustomIndicators(prev => prev.filter(ind => ind.id !== id));
  };

  // Effect to render custom indicators
  useEffect(() => {
    if (!chartRef.current || !data.length || customIndicators.length === 0) return;

    // Remove existing custom indicator series
    customIndicators.forEach(indicator => {
      const existingSeries = indicatorSeriesRef.current.get(`custom-${indicator.id}`);
      if (existingSeries && chartRef.current) {
        chartRef.current.removeSeries(existingSeries);
        indicatorSeriesRef.current.delete(`custom-${indicator.id}`);
      }
    });

    // Add custom indicators
    customIndicators.forEach(indicator => {
      if (!indicator.enabled) return;

      try {
        // Prepare data for formula evaluation
        const prices = data.map(d => d.close);
        const opens = data.map(d => d.open);
        const highs = data.map(d => d.high);
        const lows = data.map(d => d.low);
        const volumes = data.map(d => d.volume);
        
        // Evaluate the formula
        // eslint-disable-next-line no-new-func
        const calculateValues = new Function(
          'prices', 'open', 'high', 'low', 'volume', 
          `return ${indicator.formula}`
        );
        
        const values = calculateValues(prices, opens, highs, lows, volumes);
        
        if (!Array.isArray(values) || values.length !== data.length) {
          console.error('Custom indicator formula must return an array with same length as data');
          return;
        }

        // Create series
        if (chartRef.current) {
          const series = chartRef.current.addSeries(LineSeries, {
            color: indicator.color,
            lineWidth: indicator.lineWidth as 1 | 2 | 3 | 4,
            title: indicator.name,
          });

          const seriesData: LineData[] = values.map((value, i) => ({
            time: (data[i].time / 1000) as Time,
            value: isNaN(value) || value === null || value === undefined ? data[i].close : value,
          }));

          series.setData(seriesData);
          indicatorSeriesRef.current.set(`custom-${indicator.id}`, series);
        }
      } catch (error) {
        console.error(`Error evaluating custom indicator "${indicator.name}":`, error);
      }
    });
  }, [data, customIndicators]);

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
            
            <button
              className="indicator-toggle"
              onClick={() => setShowCustomPanel(!showCustomPanel)}
            >
              {showCustomPanel ? '🔧 Hide Custom' : '🔧 Custom Indicators'}
            </button>
            
            {showIndicators && (indicators.ema5 || indicators.ema8 || indicators.ema9 || indicators.ema13) && (
              <div className={`trend-indicator trend-${ripsterTrend}`}>
                Ripster Trend: {ripsterTrend.toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showIndicators && (
        <div className="indicator-panel">
          <div className="indicator-checkboxes">
            <div className="indicator-group">
              <h4>Ripster EMAs</h4>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.ripsterCloud}
                  onChange={() => {
                    const newValue = !indicators.ripsterCloud;
                    setIndicators(prev => ({ 
                      ...prev, 
                      ripsterCloud: newValue,
                      ema5: newValue,
                      ema8: newValue,
                      ema9: newValue,
                      ema13: newValue,
                    }));
                  }}
                />
                Ripster Cloud (5,8,9,13)
              </label>
            </div>
            
            <div className="indicator-group">
              <h4>MTF Clouds</h4>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.mtfClouds}
                  onChange={() => toggleIndicator('mtfClouds')}
                />
                MTF Clouds (34,50,72)
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
            </div>
            
            <div className="indicator-group">
              <h4>Panels</h4>
              <label>
                <input
                  type="checkbox"
                  checked={indicators.volume}
                  onChange={() => toggleIndicator('volume')}
                />
                Volume
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
            </div>
          </div>
        </div>
      )}
      
      {showCustomPanel && (
        <div className="custom-panel-overlay">
          <CustomIndicatorPanel
            indicators={customIndicators}
            onAddIndicator={handleAddCustomIndicator}
            onRemoveIndicator={handleRemoveCustomIndicator}
          />
        </div>
      )}
      
      <div ref={chartContainerRef} className="chart" />
      
      <IndicatorPanels 
        data={data}
        showVolume={indicators.volume}
        showRSI={indicators.rsi}
        showMACD={indicators.macd}
      />
    </div>
  );
};
