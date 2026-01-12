import React, { useEffect, useRef } from 'react';
import {
  createChart,
  IChartApi,
  Time,
  HistogramData,
  LineData,
  HistogramSeries,
  LineSeries
} from 'lightweight-charts';
import { ChartData } from '../types';
import { calculateRSI, calculateEMA } from '../utils/indicators';
import './IndicatorPanels.css';

interface IndicatorPanelsProps {
  data: ChartData[];
  showVolume: boolean;
  showRSI: boolean;
  showMACD: boolean;
}

export const IndicatorPanels: React.FC<IndicatorPanelsProps> = ({
  data,
  showVolume,
  showRSI,
  showMACD,
}) => {
  const volumeContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  
  const volumeChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  // Volume Panel
  useEffect(() => {
    if (!showVolume || !volumeContainerRef.current || !data.length) {
      if (volumeChartRef.current) {
        volumeChartRef.current.remove();
        volumeChartRef.current = null;
      }
      return;
    }

    // Create volume chart
    const chart = createChart(volumeContainerRef.current, {
      layout: {
        background: { color: '#0a0e27' },
        textColor: '#e0e0e0',
      },
      grid: {
        vertLines: { color: '#1a1e3f' },
        horzLines: { color: '#1a1e3f' },
      },
      width: volumeContainerRef.current.clientWidth,
      height: 120,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a2e4f',
      },
      rightPriceScale: {
        borderColor: '#2a2e4f',
      },
    });

    volumeChartRef.current = chart;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
    });

    const volumeData: HistogramData[] = data.map((d, i) => {
      const prevClose = i > 0 ? data[i - 1].close : d.close;
      const color = d.close >= prevClose ? '#26a69a' : '#ef5350';
      return {
        time: (d.time / 1000) as Time,
        value: d.volume,
        color,
      };
    });

    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (volumeContainerRef.current && volumeChartRef.current) {
        volumeChartRef.current.applyOptions({
          width: volumeContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, showVolume]);

  // RSI Panel
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current || !data.length || data.length < 15) {
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
      }
      return;
    }

    // Create RSI chart
    const chart = createChart(rsiContainerRef.current, {
      layout: {
        background: { color: '#0a0e27' },
        textColor: '#e0e0e0',
      },
      grid: {
        vertLines: { color: '#1a1e3f' },
        horzLines: { color: '#1a1e3f' },
      },
      width: rsiContainerRef.current.clientWidth,
      height: 120,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a2e4f',
      },
      rightPriceScale: {
        borderColor: '#2a2e4f',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
    });

    rsiChartRef.current = chart;

    // Calculate RSI values for each point
    const closes = data.map(d => d.close);
    const rsiValues: number[] = [];
    
    for (let i = 0; i < closes.length; i++) {
      if (i < 14) {
        rsiValues.push(50); // Default value for insufficient data
      } else {
        const slice = closes.slice(0, i + 1);
        rsiValues.push(calculateRSI(slice, 14));
      }
    }

    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#2196F3',
      lineWidth: 2,
      title: 'RSI',
    });

    const rsiData: LineData[] = rsiValues.map((value, i) => ({
      time: (data[i].time / 1000) as Time,
      value,
    }));

    rsiSeries.setData(rsiData);

    // Add overbought/oversold lines
    const overboughtSeries = chart.addSeries(LineSeries, {
      color: '#ef5350',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const oversoldSeries = chart.addSeries(LineSeries, {
      color: '#26a69a',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const overboughtData: LineData[] = data.map(d => ({
      time: (d.time / 1000) as Time,
      value: 70,
    }));

    const oversoldData: LineData[] = data.map(d => ({
      time: (d.time / 1000) as Time,
      value: 30,
    }));

    overboughtSeries.setData(overboughtData);
    oversoldSeries.setData(oversoldData);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (rsiContainerRef.current && rsiChartRef.current) {
        rsiChartRef.current.applyOptions({
          width: rsiContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, showRSI]);

  // MACD Panel
  useEffect(() => {
    if (!showMACD || !macdContainerRef.current || !data.length || data.length < 26) {
      if (macdChartRef.current) {
        macdChartRef.current.remove();
        macdChartRef.current = null;
      }
      return;
    }

    // Create MACD chart
    const chart = createChart(macdContainerRef.current, {
      layout: {
        background: { color: '#0a0e27' },
        textColor: '#e0e0e0',
      },
      grid: {
        vertLines: { color: '#1a1e3f' },
        horzLines: { color: '#1a1e3f' },
      },
      width: macdContainerRef.current.clientWidth,
      height: 120,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a2e4f',
      },
      rightPriceScale: {
        borderColor: '#2a2e4f',
      },
    });

    macdChartRef.current = chart;

    // Calculate MACD
    const closes = data.map(d => d.close);
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    
    const macdLine: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (!isNaN(ema12[i]) && !isNaN(ema26[i])) {
        macdLine.push(ema12[i] - ema26[i]);
      } else {
        macdLine.push(NaN);
      }
    }
    
    // Calculate signal line (9-period EMA of MACD)
    // Filter out NaN values (but keep zeros which are valid)
    const validMacd = macdLine.filter(v => !isNaN(v));
    const signalLineValues = calculateEMA(validMacd, 9);
    const signalLine: number[] = [];
    let signalIndex = 0;
    
    for (let i = 0; i < macdLine.length; i++) {
      if (isNaN(macdLine[i])) {
        signalLine.push(NaN);
      } else {
        signalLine.push(signalLineValues[signalIndex] || 0);
        signalIndex++;
      }
    }

    // Histogram data (MACD - Signal)
    const histogramSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
    });

    const histogramData: HistogramData[] = macdLine.map((macd, i) => {
      const hist = macd - signalLine[i];
      return {
        time: (data[i].time / 1000) as Time,
        value: hist,
        color: hist >= 0 ? '#26a69a' : '#ef5350',
      };
    });

    histogramSeries.setData(histogramData);

    // MACD line
    const macdSeries = chart.addSeries(LineSeries, {
      color: '#2196F3',
      lineWidth: 2,
      title: 'MACD',
    });

    const macdLineData: LineData[] = macdLine.map((value, i) => ({
      time: (data[i].time / 1000) as Time,
      value,
    }));

    macdSeries.setData(macdLineData);

    // Signal line
    const signalSeries = chart.addSeries(LineSeries, {
      color: '#FF9800',
      lineWidth: 2,
      title: 'Signal',
    });

    const signalLineData: LineData[] = signalLine.map((value, i) => ({
      time: (data[i].time / 1000) as Time,
      value,
    }));

    signalSeries.setData(signalLineData);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (macdContainerRef.current && macdChartRef.current) {
        macdChartRef.current.applyOptions({
          width: macdContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, showMACD]);

  return (
    <div className="indicator-panels">
      {showVolume && (
        <div className="panel-container">
          <div className="panel-header">Volume</div>
          <div ref={volumeContainerRef} className="panel-chart" />
        </div>
      )}
      
      {showRSI && (
        <div className="panel-container">
          <div className="panel-header">RSI (14)</div>
          <div ref={rsiContainerRef} className="panel-chart" />
        </div>
      )}
      
      {showMACD && (
        <div className="panel-container">
          <div className="panel-header">MACD (12, 26, 9)</div>
          <div ref={macdContainerRef} className="panel-chart" />
        </div>
      )}
    </div>
  );
};
