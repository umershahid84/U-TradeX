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
import { ChartData, TimeFrame, CustomIndicator, CustomIndicatorStatus } from '../types';
import { calculateEMAFromFirst, calculateSMA, calculateVWAP, calculateBollingerBands } from '../utils/indicators';
import { DrawingTools, DrawingTool } from './DrawingTools';
import { IndicatorPanels } from './IndicatorPanels';
import { CustomIndicatorPanel } from './CustomIndicatorPanel';
import { CustomIndicatorManager } from './customIndicatorManager';
import { CloudSeries } from '../plugins/cloudSeries';
import './TradingChart.css';

interface TradingChartProps {
  symbol: string;
  timeframe: TimeFrame;
  data: ChartData[];
  onPriceUpdate?: (price: number) => void;
}

interface CloudPair {
  enabled: boolean;
  fast: number;
  slow: number;
}

interface CloudGroup {
  enabled: boolean;
  showLines: boolean;
  pairs: CloudPair[];
}

type CloudKey = 'ripster' | 'mtf';
type CloudConfig = Record<CloudKey, CloudGroup>;

// Ripster's standard clouds are 5/12, 8/9, 34/50, 72/89 and 180/200. The first two are
// his short-term clouds; the longer ones are what the MTF cloud tracks.
const DEFAULT_CLOUDS: CloudConfig = {
  ripster: {
    enabled: false,
    showLines: false,
    pairs: [
      { enabled: true, fast: 8, slow: 9 },
      { enabled: true, fast: 5, slow: 12 },
    ],
  },
  mtf: {
    enabled: false,
    showLines: false,
    pairs: [
      { enabled: true, fast: 34, slow: 50 },
      { enabled: true, fast: 72, slow: 89 },
    ],
  },
};

const CLOUD_PALETTE: Record<CloudKey, { bull: string; bear: string; line: string }[]> = {
  ripster: [
    { bull: 'rgba(76, 175, 80, 0.35)', bear: 'rgba(239, 83, 80, 0.35)', line: '#4CAF50' },
    { bull: 'rgba(38, 166, 154, 0.22)', bear: 'rgba(255, 112, 67, 0.22)', line: '#26A69A' },
    { bull: 'rgba(156, 204, 101, 0.22)', bear: 'rgba(240, 98, 146, 0.22)', line: '#9CCC65' },
  ],
  mtf: [
    { bull: 'rgba(41, 182, 246, 0.30)', bear: 'rgba(171, 71, 188, 0.30)', line: '#29B6F6' },
    { bull: 'rgba(63, 81, 181, 0.25)', bear: 'rgba(255, 152, 0, 0.25)', line: '#5C6BC0' },
    { bull: 'rgba(0, 188, 212, 0.22)', bear: 'rgba(233, 30, 99, 0.22)', line: '#00BCD4' },
  ],
};

const MAX_CLOUD_PAIRS = 5;

const loadClouds = (): CloudConfig => {
  try {
    const saved = JSON.parse(localStorage.getItem('cloudConfig') ?? 'null');
    if (saved?.ripster?.pairs && saved?.mtf?.pairs) return saved;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_CLOUDS;
};

interface IndicatorState {
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
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
  const customManagerRef = useRef<CustomIndicatorManager | null>(null);
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
  // Only the selector menu: indicators stay on the chart when the menu is closed
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [clouds, setClouds] = useState<CloudConfig>(loadClouds);
  const indicatorPanelRef = useRef<HTMLDivElement>(null);
  const [showFibonacci, setShowFibonacci] = useState(false);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>('none');
  const [ripsterTrend, setRipsterTrend] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [customIndicators, setCustomIndicators] = useState<CustomIndicator[]>(() => {
    try {
      const saved = localStorage.getItem('customIndicators');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [customStatuses, setCustomStatuses] = useState<Record<string, CustomIndicatorStatus>>({});
  const [indicators, setIndicators] = useState<IndicatorState>({
    sma20: false,
    sma50: false,
    sma100: false,
    sma200: false,
    vwap: false,
    rsi: false,
    macd: false,
    bb: false,
    volume: true,
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
        const timeStep = (rectMaxTime - rectMinTime) / RECTANGLE_SEGMENTS;
        
        // Top line
        const topSeries = chartRef.current.addSeries(LineSeries, {
          color: '#9C27B0',
          lineWidth: 2,
          title: 'Rectangle',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const topLineData: LineData[] = [];
        for (let i = 0; i <= RECTANGLE_SEGMENTS; i++) {
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
        for (let i = 0; i <= RECTANGLE_SEGMENTS; i++) {
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
        const priceStep = (rectMaxPrice - rectMinPrice) / RECTANGLE_SEGMENTS;
        const leftLineData: LineData[] = [];
        for (let i = 0; i <= RECTANGLE_SEGMENTS; i++) {
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
        for (let i = 0; i <= RECTANGLE_SEGMENTS; i++) {
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
    customManagerRef.current = new CustomIndicatorManager(chart, candleSeries);

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
    {
      const closes = data.map(d => d.close);
      const emaCache = new Map<number, number[]>();
      const emaOf = (period: number) => {
        let v = emaCache.get(period);
        if (!v) { v = calculateEMAFromFirst(closes, period); emaCache.set(period, v); }
        return v;
      };

      // Shades the area between two EMAs: green while the fast EMA is above the slow one, red below
      const addCloud = (key: string, fast: number[], slow: number[], bull: string, bear: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        const cloud = chart.addCustomSeries(new CloudSeries(), { bullColor: bull, bearColor: bear });
        cloud.setData(
          data.map((d, i) =>
            Number.isFinite(fast[i]) && Number.isFinite(slow[i])
              ? { time: (d.time / 1000) as Time, upper: fast[i], lower: slow[i] }
              : { time: (d.time / 1000) as Time }
          ) as any
        );
        cloud.setSeriesOrder(0); // draw behind candles and lines
        indicatorSeriesRef.current.set(key, cloud);
      };

      (['ripster', 'mtf'] as CloudKey[]).forEach((key) => {
        const group = clouds[key];
        if (!group.enabled) return;
        group.pairs.forEach((pair, idx) => {
          if (!pair.enabled) return;
          const colors = CLOUD_PALETTE[key][idx % CLOUD_PALETTE[key].length];
          const fast = emaOf(pair.fast);
          const slow = emaOf(pair.slow);
          addCloud(`${key}-cloud-${idx}`, fast, slow, colors.bull, colors.bear);
          if (group.showLines && chartRef.current) {
            [[pair.fast, fast], [pair.slow, slow]].forEach(([period, values]) => {
              const line = chartRef.current!.addSeries(LineSeries, {
                color: colors.line,
                lineWidth: 1,
                title: `EMA ${period}`,
                priceLineVisible: false,
                lastValueVisible: false,
              });
              line.setData(
                (values as number[]).map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
              );
              indicatorSeriesRef.current.set(`${key}-line-${idx}-${period}`, line);
            });
          }
        });
      });

      // Add SMA 20
      if (indicators.sma20) {
        const sma20 = calculateSMA(closes, 20);
        const sma20Series = chartRef.current.addSeries(LineSeries, {
          color: '#FFC107',
          lineWidth: 2,
          title: 'SMA 20',
        });
        const sma20Data: LineData[] = sma20.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
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
        const sma50Data: LineData[] = sma50.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
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
        const sma100Data: LineData[] = sma100.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
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
        const sma200Data: LineData[] = sma200.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
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
        const bbUpperData: LineData[] = bb.upper.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
        bbUpperSeries.setData(bbUpperData);
        indicatorSeriesRef.current.set('bbUpper', bbUpperSeries);

        const bbMiddleSeries = chartRef.current.addSeries(LineSeries, {
          color: '#F06292',
          lineWidth: 1,
          title: 'BB Middle',
        });
        const bbMiddleData: LineData[] = bb.middle.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
        bbMiddleSeries.setData(bbMiddleData);
        indicatorSeriesRef.current.set('bbMiddle', bbMiddleSeries);

        const bbLowerSeries = chartRef.current.addSeries(LineSeries, {
          color: '#E91E63',
          lineWidth: 1,
          title: 'BB Lower',
        });
        const bbLowerData: LineData[] = bb.lower.map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
          .filter((p) => !isNaN(p.value));
        bbLowerSeries.setData(bbLowerData);
        indicatorSeriesRef.current.set('bbLower', bbLowerSeries);
      }
    }
  }, [data, indicators, clouds]);

  // Ripster trend from the enabled Ripster clouds: bullish when price is above every cloud EMA
  // and each fast EMA is above its slow EMA, bearish for the mirror image
  useEffect(() => {
    const group = clouds.ripster;
    const pairs = group.pairs.filter((p) => p.enabled);
    if (!data.length || !group.enabled || pairs.length === 0) return;

    const closes = data.map(d => d.close);
    const price = closes[closes.length - 1];
    const last = (period: number) => {
      const v = calculateEMAFromFirst(closes, period);
      return v[v.length - 1];
    };
    const emas = pairs.map((p) => ({ fast: last(p.fast), slow: last(p.slow) }));
    const allEmas = emas.flatMap((e) => [e.fast, e.slow]);

    if (price > Math.max(...allEmas) && emas.every((e) => e.fast > e.slow)) setRipsterTrend('bullish');
    else if (price < Math.min(...allEmas) && emas.every((e) => e.fast < e.slow)) setRipsterTrend('bearish');
    else setRipsterTrend('neutral');
  }, [data, clouds]);

  useEffect(() => {
    try {
      localStorage.setItem('cloudConfig', JSON.stringify(clouds));
    } catch {
      /* storage unavailable */
    }
  }, [clouds]);

  // Close the indicator menu when clicking elsewhere (indicators stay on the chart)
  useEffect(() => {
    if (!showIndicatorPanel) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element | null;
      if (target && !target.closest('.indicator-panel, .indicator-toggle')) setShowIndicatorPanel(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [showIndicatorPanel]);

  const updateGroup = (key: CloudKey, patch: Partial<CloudGroup>) =>
    setClouds((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const updatePair = (key: CloudKey, idx: number, patch: Partial<CloudPair>) =>
    setClouds((prev) => ({
      ...prev,
      [key]: { ...prev[key], pairs: prev[key].pairs.map((p, i) => (i === idx ? { ...p, ...patch } : p)) },
    }));

  const addPair = (key: CloudKey) =>
    setClouds((prev) => {
      const pairs = prev[key].pairs;
      if (pairs.length >= MAX_CLOUD_PAIRS) return prev;
      const lastSlow = pairs.length ? pairs[pairs.length - 1].slow : 20;
      return { ...prev, [key]: { ...prev[key], pairs: [...pairs, { enabled: true, fast: lastSlow + 1, slow: lastSlow + 20 }] } };
    });

  const removePair = (key: CloudKey, idx: number) =>
    setClouds((prev) => ({ ...prev, [key]: { ...prev[key], pairs: prev[key].pairs.filter((_, i) => i !== idx) } }));

  const renderCloudGroup = (key: CloudKey, title: string) => {
    const group = clouds[key];
    return (
      <div className="indicator-group cloud-group">
        <h4>{title}</h4>
        <label>
          <input type="checkbox" checked={group.enabled} onChange={() => updateGroup(key, { enabled: !group.enabled })} />
          Show cloud
        </label>
        <label>
          <input type="checkbox" checked={group.showLines} onChange={() => updateGroup(key, { showLines: !group.showLines })} />
          Show EMA lines
        </label>
        {group.pairs.map((pair, idx) => (
          <div key={idx} className={`cloud-pair ${group.enabled && pair.enabled ? '' : 'off'}`}>
            <input
              type="checkbox"
              checked={pair.enabled}
              onChange={() => updatePair(key, idx, { enabled: !pair.enabled })}
              title="Toggle this cloud"
            />
            <span className="cloud-swatch" style={{ background: CLOUD_PALETTE[key][idx % CLOUD_PALETTE[key].length].line }} />
            <span>EMA</span>
            <input
              type="number" min={1} max={500} value={pair.fast}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 500) updatePair(key, idx, { fast: v }); }}
            />
            <span>/</span>
            <input
              type="number" min={1} max={500} value={pair.slow}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 500) updatePair(key, idx, { slow: v }); }}
            />
            <button className="cloud-remove" onClick={() => removePair(key, idx)} title="Remove this cloud">✖</button>
          </div>
        ))}
        {group.pairs.length < MAX_CLOUD_PAIRS && (
          <button className="cloud-add" onClick={() => addPair(key)}>+ Add cloud</button>
        )}
      </div>
    );
  };

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

  const handleUpdateCustomIndicator = (id: string, patch: Partial<CustomIndicator>) => {
    setCustomIndicators(prev => prev.map(ind => (ind.id === id ? { ...ind, ...patch } : ind)));
  };

  const handleRemoveCustomIndicator = (id: string) => {
    setCustomIndicators(prev => prev.filter(ind => ind.id !== id));
  };

  // Constants for drawing
  const RECTANGLE_SEGMENTS = 10; // Number of segments for smooth rectangle rendering

  // Render custom (Pine Script / JavaScript) indicators. They live in their own manager,
  // so toggling built-in indicators never removes them and removed ones are cleaned up.
  useEffect(() => {
    const manager = customManagerRef.current;
    if (!manager || !data.length) return;
    const statuses = manager.sync(customIndicators, data);
    setCustomStatuses((prev) => (JSON.stringify(prev) === JSON.stringify(statuses) ? prev : statuses));
  }, [data, customIndicators]);

  useEffect(() => {
    try {
      localStorage.setItem('customIndicators', JSON.stringify(customIndicators));
    } catch {
      /* storage unavailable */
    }
  }, [customIndicators]);

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
              onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
            >
              {showIndicatorPanel ? '📊 Close Menu' : '📊 Indicators'}
            </button>
            
            <button
              className="indicator-toggle"
              onClick={() => setShowCustomPanel(!showCustomPanel)}
            >
              {showCustomPanel ? '🔧 Hide Custom' : '🔧 Custom Indicators'}
            </button>
            
            {clouds.ripster.enabled && clouds.ripster.pairs.some((p) => p.enabled) && (
              <div className={`trend-indicator trend-${ripsterTrend}`}>
                Ripster Trend: {ripsterTrend.toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showIndicatorPanel && (
        <div className="indicator-panel" ref={indicatorPanelRef}>
          <button className="panel-close" onClick={() => setShowIndicatorPanel(false)} title="Close menu (indicators stay on the chart)">✕</button>
          <div className="indicator-checkboxes">
            {renderCloudGroup('ripster', 'Ripster EMA Clouds')}
            {renderCloudGroup('mtf', 'MTF Clouds')}

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
            statuses={customStatuses}
            onAddIndicator={handleAddCustomIndicator}
            onUpdateIndicator={handleUpdateCustomIndicator}
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
