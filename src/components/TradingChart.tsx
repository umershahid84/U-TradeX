import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  IPriceLine,
  CandlestickData, 
  Time, 
  LineData,
  CandlestickSeries,
  LineSeries
} from 'lightweight-charts';
import { ChartData, TimeFrame, CustomIndicator, CustomIndicatorStatus, PriceAlert } from '../types';
import { AlertsPanel } from './AlertsPanel';
import { AutoChartManager, AutoChartOptions } from './autoChartManager';
import { AutoChartBadge } from './AutoChartBadge';
import { analyzeChart } from '../utils/autoChart';
import { calculateSMA, calculateVWAP, calculateBollingerBands } from '../utils/indicators';
import { CloudTf, alignHtfMa, buildTimeframeBars, chartIntervalMs, movingAverage, shiftSeries, sourceValue, tfOption } from '../utils/htfEma';
import {
  CloudConfig, CloudGroup, CloudKey, CLOUD_TITLES, hexToRgba, isVisibleOn, loadCloudConfig, saveCloudConfig,
} from './emaClouds/cloudConfig';
import { CloudSettingsDialog } from './emaClouds/CloudSettingsDialog';
import { RealMarketDataService } from '../services/realMarketData';
import { DrawingTools, DrawingTool } from './DrawingTools';
import { IndicatorPanels } from './IndicatorPanels';
import { CustomIndicatorPanel } from './CustomIndicatorPanel';
import { CustomIndicatorManager } from './customIndicatorManager';
import { CloudSeries } from '../plugins/cloudSeries';
import { attachSessionBands, SessionBandsPrimitive } from '../plugins/sessionBands';
import { buildSessionLayout, sessionAt, SESSION_COLOR } from '../utils/marketSessions';
import './TradingChart.css';

interface TradingChartProps {
  symbol: string;
  timeframe: TimeFrame;
  data: ChartData[];
  onPriceUpdate?: (price: number) => void;
  includeAfterHours: boolean;
  alerts: PriceAlert[];
  onAddAlert: (price: number) => void;
  onMoveAlert: (id: string, price: number) => void;
  onRemoveAlert: (id: string) => void;
  onClearTriggeredAlerts: () => void;
  onSelectSymbol: (symbol: string) => void;
}

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
  timeframe,
  data,
  onPriceUpdate,
  includeAfterHours,
  alerts,
  onAddAlert,
  onMoveAlert,
  onRemoveAlert,
  onClearTriggeredAlerts,
  onSelectSymbol,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null) as any;
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
  const customManagerRef = useRef<CustomIndicatorManager | null>(null);
  const sessionBandsRef = useRef<SessionBandsPrimitive | null>(null);
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
  const [clouds, setClouds] = useState<CloudConfig>(loadCloudConfig);
  // Which cloud indicator's settings dialog is open
  const [cloudDialog, setCloudDialog] = useState<CloudKey | null>(null);
  // Higher-timeframe bars for clouds whose timeframe differs from the chart's, keyed by timeframe
  const [htfBars, setHtfBars] = useState<Partial<Record<CloudTf, ChartData[]>>>({});
  const [htfLoading, setHtfLoading] = useState(false);
  const indicatorPanelRef = useRef<HTMLDivElement>(null);
  const [showFibonacci, setShowFibonacci] = useState(false);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>('none');
  const [ripsterTrend, setRipsterTrend] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const autoChartRef = useRef<AutoChartManager | null>(null);
  const [autoChart, setAutoChart] = useState<AutoChartOptions>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('autoChart') ?? 'null');
      if (saved && typeof saved.enabled === 'boolean') return saved;
    } catch {
      /* defaults */
    }
    return { enabled: false, levels: true, trendlines: true, patterns: true };
  });
  // While armed, the next click on the chart places a price alert at that price
  const [alertArmed, setAlertArmed] = useState(false);
  const alertArmedRef = useRef(false);
  const onAddAlertRef = useRef(onAddAlert);
  onAddAlertRef.current = onAddAlert;
  const alertLinesRef = useRef<{ id: string; line: IPriceLine }[]>([]);
  const activeAlertsRef = useRef<PriceAlert[]>([]);
  const onMoveAlertRef = useRef(onMoveAlert);
  onMoveAlertRef.current = onMoveAlert;
  // Right-click menu: add an alert at the cursor's price, or delete the alert under it
  const [menu, setMenu] = useState<{ x: number; y: number; price: number; alertId?: string; alertPrice?: number } | null>(null);
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
    sessionBandsRef.current = attachSessionBands(candleSeries);
    autoChartRef.current = new AutoChartManager(chart, candleSeries);

    // Add click handler for drawing tools
    chart.subscribeClick((param) => {
      // Armed from the alerts panel: place an alert at the clicked price
      if (alertArmedRef.current && param.point) {
        const alertPrice = candleSeries.coordinateToPrice(param.point.y);
        if (alertPrice) onAddAlertRef.current(alertPrice as number);
        alertArmedRef.current = false;
        setAlertArmed(false);
        return;
      }
      if (!param.time || !param.point) return;
      
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (!price) return;

      handleChartClick(param.time as Time, price as number);
    });

    // Handle resize. When the width changes (e.g. a sidebar is shown or hidden) refit the
    // candles so they use the new space instead of staying bunched to one side.
    let lastWidth = chartContainerRef.current.clientWidth;
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const width = chartContainerRef.current.clientWidth;
        chartRef.current.applyOptions({
          width,
          height: chartContainerRef.current.clientHeight,
        });
        if (width !== lastWidth) {
          lastWidth = width;
          chartRef.current.timeScale().fitContent();
        }
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
    // Extended-hours candles are drawn paler than regular-session ones, like other platforms
    const chartData: CandlestickData[] = data.map(d => {
      const candle: CandlestickData = {
        time: (d.time / 1000) as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      };
      const session = sessionAt(d.time);
      if (session !== 'regular') {
        const c = d.close >= d.open ? 'rgba(38, 166, 154, 0.55)' : 'rgba(239, 83, 80, 0.55)';
        candle.color = c;
        candle.wickColor = c;
        candle.borderColor = c;
      }
      return candle;
    });

    candleSeriesRef.current.setData(chartData);

    const { bands, gaps } = buildSessionLayout(data);
    sessionBandsRef.current?.setLayout(bands, gaps);

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

  // Load bars for every timeframe a visible cloud uses, and keep them fresh
  const chartMs = chartIntervalMs(data);

  const neededTfs = (['ripster', 'mtf'] as CloudKey[])
    .filter((k) => clouds[k].enabled && isVisibleOn(clouds[k], chartMs))
    .flatMap((k) => clouds[k].clouds.filter((c) => c.enabled).map((c) => c.tf))
    .filter((tf) => tf !== 'chart')
    .filter((tf, i, all) => all.indexOf(tf) === i)
    .sort()
    .join(',');

  useEffect(() => {
    setHtfBars({});
  }, [symbol, includeAfterHours]);

  useEffect(() => {
    if (!neededTfs) return;
    let cancelled = false;
    const market = RealMarketDataService.getInstance();
    const load = async (initial: boolean) => {
      if (initial) setHtfLoading(true);
      await Promise.all(
        neededTfs.split(',').map(async (tf) => {
          const opt = tfOption(tf as CloudTf);
          if (!opt.interval) return;
          try {
            const raw = await market.fetchChartData(symbol, opt.interval, opt.range ?? '1mo', includeAfterHours);
            const bars = buildTimeframeBars(raw, opt);
            if (!cancelled) setHtfBars((prev) => ({ ...prev, [tf]: bars }));
          } catch {
            /* keep whatever we had; retry on the next refresh */
          }
        })
      );
      if (!cancelled && initial) setHtfLoading(false);
    };
    void load(true);
    const id = setInterval(() => void load(false), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [neededTfs, symbol, includeAfterHours]);

  // A cloud's average on its own timeframe (EMA or SMA of the chosen source), lined up with the chart's
  // bars and shifted by the indicator's offset
  const makeMaFor = (chartData: ChartData[], group: CloudGroup) => {
    const cache = new Map<string, number[]>();
    return (tf: CloudTf, period: number): number[] => {
      const key = `${tf}:${period}`;
      let v = cache.get(key);
      if (!v) {
        if (tf === 'chart') {
          v = movingAverage(chartData.map((d) => sourceValue(d, group.source)), period, group.maType);
        } else {
          const bars = htfBars[tf];
          // not loaded yet: draw nothing rather than the wrong timeframe
          v = bars ? alignHtfMa(chartData, bars, tfOption(tf).ms, period, group.maType, group.source) : chartData.map(() => NaN);
        }
        v = shiftSeries(v, group.offset);
        cache.set(key, v);
      }
      return v;
    };
  };

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
        if (!group.enabled || !isVisibleOn(group, chartMs)) return;
        const maFor = makeMaFor(data, group);
        group.clouds.forEach((cl, idx) => {
          if (!cl.enabled) return;
          const short = maFor(cl.tf, cl.short);
          const long = maFor(cl.tf, cl.long);
          if (cl.fill) {
            addCloud(`${key}-cloud-${idx}`, short, long, hexToRgba(cl.bull, cl.bullOpacity), hexToRgba(cl.bear, cl.bearOpacity));
          }
          if (cl.lines && chartRef.current) {
            [[cl.short, short, cl.shortColor], [cl.long, long, cl.longColor]].forEach(([period, values, color]) => {
              const line = chartRef.current!.addSeries(LineSeries, {
                color: color as string,
                lineWidth: cl.lineWidth,
                title: cl.tf === 'chart' ? `${group.maType} ${period}` : `${group.maType} ${period} ${tfOption(cl.tf).short}`,
                priceLineVisible: false,
                lastValueVisible: false,
              });
              line.setData(
                (values as number[])
                  .map((value, i) => ({ time: (data[i].time / 1000) as Time, value }))
                  .filter((pt) => Number.isFinite(pt.value)) // higher-timeframe averages start later or are still loading
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
  }, [data, indicators, clouds, htfBars, chartMs]);

  // Ripster trend from the enabled Ripster clouds: bullish when price is above every cloud average
  // and each short average is above its long one, bearish for the mirror image
  useEffect(() => {
    const group = clouds.ripster;
    const active = group.clouds.filter((c) => c.enabled);
    if (!data.length || !group.enabled || active.length === 0 || !isVisibleOn(group, chartMs)) return;

    const price = data[data.length - 1].close;
    const maFor = makeMaFor(data, group);
    const last = (tf: CloudTf, period: number) => {
      const v = maFor(tf, period);
      return v[v.length - 1];
    };
    const avgs = active.map((c) => ({ short: last(c.tf, c.short), long: last(c.tf, c.long) }));
    const all = avgs.flatMap((e) => [e.short, e.long]);

    if (all.some((v) => !Number.isFinite(v))) return; // higher-timeframe data still loading
    if (price > Math.max(...all) && avgs.every((e) => e.short > e.long)) setRipsterTrend('bullish');
    else if (price < Math.min(...all) && avgs.every((e) => e.short < e.long)) setRipsterTrend('bearish');
    else setRipsterTrend('neutral');
  }, [data, clouds, htfBars, chartMs]);

  useEffect(() => {
    saveCloudConfig(clouds);
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

  const renderCloudGroup = (key: CloudKey) => {
    const group = clouds[key];
    const shown = group.clouds.filter((c) => c.enabled);
    const hidden = group.enabled && !isVisibleOn(group, chartMs);
    return (
      <div className="indicator-group cloud-group">
        <h4>{CLOUD_TITLES[key]}</h4>
        <label>
          <input type="checkbox" checked={group.enabled} onChange={() => updateGroup(key, { enabled: !group.enabled })} />
          Show
        </label>
        <button type="button" className="cloud-settings-btn" onClick={() => { setCloudDialog(key); setShowIndicatorPanel(false); }}>
          ⚙ Settings
        </button>
        <ul className="cloud-summary">
          {shown.map((c, i) => (
            <li key={i}>
              <i style={{ background: hexToRgba(c.bull, 100) }} />
              {c.short}/{c.long}
              {c.tf !== 'chart' && <em>{tfOption(c.tf).short}</em>}
            </li>
          ))}
          {shown.length === 0 && <li className="none">No clouds selected</li>}
        </ul>
        {hidden && <small className="cloud-tf-note">Hidden on this chart's timeframe (see Visibility)</small>}
        {group.enabled && !hidden && group.clouds.some((c) => c.enabled && c.tf !== 'chart' && !htfBars[c.tf]) && (
          <small className="cloud-tf-note">{htfLoading ? 'Loading candles…' : 'No data for one of the timeframes'}</small>
        )}
      </div>
    );
  };

  // Draw the active alerts of this symbol as dashed lines on the price scale
  const activeHere = alerts.filter((a) => !a.triggeredAt && a.symbol.toUpperCase() === symbol.toUpperCase());
  activeAlertsRef.current = activeHere;

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    alertLinesRef.current.forEach(({ line }) => series.removePriceLine(line));
    alertLinesRef.current = activeAlertsRef.current.map((a) => ({
      id: a.id,
      line: series.createPriceLine({
        price: a.price,
        color: '#FFB300',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `🔔 ${a.direction === 'above' ? '▲' : '▼'}`,
      }),
    }));
  }, [alerts, symbol]);

  // Right-click to add an alert at the cursor, and drag an alert's line up or down to move it
  useEffect(() => {
    const el = chartContainerRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!el || !chart || !series) return;

    const HIT_PX = 7; // how close to a line counts as grabbing it
    const paneHeight = () => chart.panes()[0]?.getHeight() ?? el.clientHeight;
    const point = (e: MouseEvent | TouchEvent) => ('touches' in e ? (e.touches[0] ?? (e as TouchEvent).changedTouches[0]) : e);

    const priceAtY = (clientY: number): number | null => {
      const y = Math.max(0, Math.min(paneHeight() - 1, clientY - el.getBoundingClientRect().top));
      const price = series.coordinateToPrice(y);
      return price === null ? null : (price as number);
    };

    // The active alert whose line is under the pointer (plot area only, not the price axis)
    const alertAt = (clientX: number, clientY: number): PriceAlert | null => {
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || x > chart.timeScale().width() || y < 0 || y > paneHeight()) return null;
      let best: PriceAlert | null = null;
      let bestDist = HIT_PX + 1;
      for (const a of activeAlertsRef.current) {
        const ay = series.priceToCoordinate(a.price);
        if (ay === null) continue;
        const d = Math.abs((ay as number) - y);
        if (d < bestDist) {
          best = a;
          bestDist = d;
        }
      }
      return best;
    };

    let drag: { id: string; price: number } | null = null;
    let restore: { scroll: unknown; scale: unknown } | null = null;

    const onDown = (e: MouseEvent | TouchEvent) => {
      if (selectedToolRef.current !== 'none' || alertArmedRef.current) return;
      if ('button' in e && e.button !== 0) return;
      const pt = point(e);
      const hit = alertAt(pt.clientX, pt.clientY);
      if (!hit) return;
      // keep the chart from panning while the line is dragged
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      drag = { id: hit.id, price: hit.price };
      restore = { scroll: chart.options().handleScroll, scale: chart.options().handleScale };
      chart.applyOptions({ handleScroll: false, handleScale: false });
      el.classList.add('alert-dragging');
      setMenu(null);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      const pt = point(e);
      if (drag) {
        if (e.cancelable) e.preventDefault();
        const price = priceAtY(pt.clientY);
        if (price !== null && price > 0) {
          drag.price = Math.round(price * 100) / 100;
          alertLinesRef.current.find((l) => l.id === drag!.id)?.line.applyOptions({ price: drag.price });
        }
        return;
      }
      if ('touches' in e) return;
      el.classList.toggle('alert-hover', alertAt(pt.clientX, pt.clientY) !== null && selectedToolRef.current === 'none');
    };

    const onUp = () => {
      if (!drag) return;
      const done = drag;
      drag = null;
      if (restore) {
        chart.applyOptions({ handleScroll: restore.scroll as never, handleScale: restore.scale as never });
        restore = null;
      }
      el.classList.remove('alert-dragging');
      onMoveAlertRef.current(done.id, done.price);
    };

    const onContext = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x > chart.timeScale().width() || y > paneHeight()) return; // axis or lower panes: leave the browser menu
      e.preventDefault();
      const price = priceAtY(e.clientY);
      if (price === null || price <= 0) return;
      const hit = alertAt(e.clientX, e.clientY);
      setMenu({ x: e.clientX, y: e.clientY, price, alertId: hit?.id, alertPrice: hit?.price });
    };

    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('touchstart', onDown, { capture: true, passive: false });
    el.addEventListener('mousemove', onMove);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    el.addEventListener('contextmenu', onContext);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      el.removeEventListener('touchstart', onDown, true);
      el.removeEventListener('mousemove', onMove);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      el.removeEventListener('contextmenu', onContext);
    };
  }, []);

  // Close the right-click menu on any click elsewhere, Esc, or scroll
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && (e.target as Element | null)?.closest('.chart-context-menu')) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // Auto charting: analyse the bars on screen and draw levels, trendlines and patterns
  const autoResult = useMemo(() => (autoChart.enabled ? analyzeChart(data) : null), [data, autoChart.enabled]);

  useEffect(() => {
    autoChartRef.current?.update(autoResult, data, autoChart);
  }, [autoResult, data, autoChart]);

  useEffect(() => {
    try {
      localStorage.setItem('autoChart', JSON.stringify(autoChart));
    } catch {
      /* storage unavailable */
    }
  }, [autoChart]);

  const armAlert = () => {
    const next = !alertArmed;
    alertArmedRef.current = next;
    setAlertArmed(next);
  };

  // Esc cancels a pending click-to-place
  useEffect(() => {
    if (!alertArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        alertArmedRef.current = false;
        setAlertArmed(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [alertArmed]);

  const activeAlertCount = alerts.filter((a) => !a.triggeredAt).length;

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
      <DrawingTools
        selectedTool={selectedTool}
        onToolSelect={handleToolSelect}
        onClearAll={handleClearAllDrawings}
      />

      <div className="chart-main">
      {isDrawingMode && (
        <div className="drawing-mode-indicator">
          Click on chart to complete {selectedTool}
        </div>
      )}
      
      <div className="chart-top-controls">
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

            <button
              className={`indicator-toggle alert-toggle ${activeAlertCount ? 'has-alerts' : ''}`}
              onClick={() => setShowAlertsPanel(!showAlertsPanel)}
            >
              🔔 Alerts{activeAlertCount ? ` (${activeAlertCount})` : ''}
            </button>
            
            {clouds.ripster.enabled && isVisibleOn(clouds.ripster, chartMs) && clouds.ripster.clouds.some((c) => c.enabled) && (
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
            {renderCloudGroup('ripster')}
            {renderCloudGroup('mtf')}

            <div className="indicator-group auto-group">
              <h4>Auto Charting</h4>
              <label>
                <input
                  type="checkbox"
                  checked={autoChart.enabled}
                  onChange={() => setAutoChart((a) => ({ ...a, enabled: !a.enabled }))}
                />
                Auto chart
              </label>
              {(['levels', 'trendlines', 'patterns'] as const).map((key) => (
                <label key={key} className={autoChart.enabled ? '' : 'sub-off'}>
                  <input
                    type="checkbox"
                    checked={autoChart[key]}
                    disabled={!autoChart.enabled}
                    onChange={() => setAutoChart((a) => ({ ...a, [key]: !a[key] }))}
                  />
                  {key === 'levels' ? 'Support / resistance' : key === 'trendlines' ? 'Trendlines' : 'Double top / bottom'}
                </label>
              ))}
              <small className="auto-hint">Bullish / bearish read, drawn from the bars on this timeframe</small>
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
      
      {alertArmed && (
        <div className="drawing-mode-indicator alert-armed-banner">Click on the chart to set an alert (Esc to cancel)</div>
      )}

      {showAlertsPanel && (
        <div className="custom-panel-overlay alerts-overlay">
          <AlertsPanel
            symbol={symbol}
            currentPrice={data.length ? data[data.length - 1].close : 0}
            alerts={alerts}
            armed={alertArmed}
            onAdd={onAddAlert}
            onArm={armAlert}
            onRemove={onRemoveAlert}
            onClearTriggered={onClearTriggeredAlerts}
            onSelectSymbol={onSelectSymbol}
          />
        </div>
      )}

      {cloudDialog && (
        <CloudSettingsDialog
          cloudKey={cloudDialog}
          group={clouds[cloudDialog]}
          chartMs={chartMs}
          onApply={(g) => updateGroup(cloudDialog, g)}
          onClose={() => setCloudDialog(null)}
        />
      )}

      {menu && (
        <div
          className="chart-context-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 90) }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.alertId ? (
            <button type="button" onClick={() => { onRemoveAlert(menu.alertId!); setMenu(null); }}>
              🗑️ Delete alert at ${menu.alertPrice!.toFixed(2)}
            </button>
          ) : (
            <button type="button" onClick={() => { onAddAlert(menu.price); setMenu(null); }}>
              🔔 Add alert at ${menu.price.toFixed(2)}
            </button>
          )}
          <span className="menu-hint">{menu.alertId ? 'Drag the line to move it' : `${symbol} · right-click`}</span>
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
      
      <div ref={chartContainerRef} className={`chart ${alertArmed ? 'alert-cursor' : ''}`} />

      {autoChart.enabled && (
        <AutoChartBadge result={autoResult} barCount={data.length} timeframe={timeframe} />
      )}

      <div className="session-legend">
        <span><i style={{ background: SESSION_COLOR.pre }} />Pre-market</span>
        <span><i style={{ background: SESSION_COLOR.regular }} />Regular</span>
        <span><i style={{ background: SESSION_COLOR.post }} />After hours</span>
        <span><i style={{ background: SESSION_COLOR.overnight }} />Overnight</span>
      </div>
      
      <IndicatorPanels 
        data={data}
        showVolume={indicators.volume}
        showRSI={indicators.rsi}
        showMACD={indicators.macd}
      />
      </div>
    </div>
  );
};
