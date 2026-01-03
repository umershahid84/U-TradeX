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
import { calculateEMA, calculateRipsterEMACloud } from '../utils/indicators';
import './TradingChart.css';

interface TradingChartProps {
  symbol: string;
  timeframe: TimeFrame;
  data: ChartData[];
  onPriceUpdate?: (price: number) => void;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  data,
  onPriceUpdate,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null) as any;
  const [showIndicators, setShowIndicators] = useState(false);
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

    // Add Ripster EMA Cloud
    if (showIndicators && chartRef.current) {
      const closes = data.map(d => d.close);
      const emaCloud = calculateRipsterEMACloud(closes);

      // Add EMA lines
      const ema5Series = chartRef.current.addSeries(LineSeries, {
        color: '#2196F3',
        lineWidth: 1,
        title: 'EMA 5',
      });

      const ema8Series = chartRef.current.addSeries(LineSeries, {
        color: '#00BCD4',
        lineWidth: 1,
        title: 'EMA 8',
      });

      const ema9Series = chartRef.current.addSeries(LineSeries, {
        color: '#009688',
        lineWidth: 1,
        title: 'EMA 9',
      });

      const ema13Series = chartRef.current.addSeries(LineSeries, {
        color: '#4CAF50',
        lineWidth: 1,
        title: 'EMA 13',
      });

      // Set EMA data
      const ema5Data: LineData[] = emaCloud.ema5.map((value, i) => ({
        time: (data[i].time / 1000) as Time,
        value: value || data[i].close,
      }));

      const ema8Data: LineData[] = emaCloud.ema8.map((value, i) => ({
        time: (data[i].time / 1000) as Time,
        value: value || data[i].close,
      }));

      const ema9Data: LineData[] = emaCloud.ema9.map((value, i) => ({
        time: (data[i].time / 1000) as Time,
        value: value || data[i].close,
      }));

      const ema13Data: LineData[] = emaCloud.ema13.map((value, i) => ({
        time: (data[i].time / 1000) as Time,
        value: value || data[i].close,
      }));

      ema5Series.setData(ema5Data);
      ema8Series.setData(ema8Data);
      ema9Series.setData(ema9Data);
      ema13Series.setData(ema13Data);

      // Add SMA lines for MTF
      const sma20 = calculateEMA(closes, 20);
      const sma50 = calculateEMA(closes, 50);

      const sma20Series = chartRef.current.addSeries(LineSeries, {
        color: '#FFC107',
        lineWidth: 2,
        title: 'SMA 20',
      });

      const sma50Series = chartRef.current.addSeries(LineSeries, {
        color: '#FF9800',
        lineWidth: 2,
        title: 'SMA 50',
      });

      const sma20Data: LineData[] = sma20.map((value, i) => ({
        time: (data[i].time / 1000) as Time,
        value: value || data[i].close,
      }));

      const sma50Data: LineData[] = sma50.map((value, i) => ({
        time: (data[i].time / 1000) as Time,
        value: value || data[i].close,
      }));

      sma20Series.setData(sma20Data);
      sma50Series.setData(sma50Data);
    }

    // Notify parent of latest price
    if (onPriceUpdate && data.length > 0) {
      onPriceUpdate(data[data.length - 1].close);
    }

    // Fit content only on initial load
    if (isInitialLoadRef.current && data.length > 0) {
      chartRef.current?.timeScale().fitContent();
      isInitialLoadRef.current = false;
    }
  }, [data, showIndicators, onPriceUpdate]);

  return (
    <div className="trading-chart-container">
      <div className="chart-controls">
        <button
          className="indicator-toggle"
          onClick={() => setShowIndicators(!showIndicators)}
        >
          {showIndicators ? '📊 Hide Indicators' : '📊 Show Indicators'}
        </button>
      </div>
      <div ref={chartContainerRef} className="chart" />
    </div>
  );
};
