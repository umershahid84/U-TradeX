import axios from 'axios';
import { ChartData } from '../types';

// Free API endpoints for real market data
// Using Yahoo Finance API (via query1.finance.yahoo.com)
// This is a free public API that doesn't require an API key

export interface OptionChainData {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}

export interface OptionChain {
  calls: OptionChainData[];
  puts: OptionChainData[];
  expirationDate: string;
}

export class RealMarketDataService {
  private static instance: RealMarketDataService;
  private priceCache: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): RealMarketDataService {
    if (!RealMarketDataService.instance) {
      RealMarketDataService.instance = new RealMarketDataService();
    }
    return RealMarketDataService.instance;
  }

  // Fetch real historical data from Yahoo Finance
  async fetchChartData(
    symbol: string,
    interval: string = '5m',
    range: string = '1d'
  ): Promise<ChartData[]> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
      const params = {
        interval,
        range,
        includePrePost: false,
      };

      const response = await axios.get(url, { params });
      const result = response.data.chart.result[0];

      if (!result || !result.timestamp) {
        console.error('No data returned for', symbol);
        return this.generateFallbackData(symbol, interval, range);
      }

      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];

      const chartData: ChartData[] = timestamps.map((time: number, i: number) => ({
        time: time * 1000, // Convert to milliseconds
        open: quotes.open[i] || quotes.close[i] || 0,
        high: quotes.high[i] || quotes.close[i] || 0,
        low: quotes.low[i] || quotes.close[i] || 0,
        close: quotes.close[i] || 0,
        volume: quotes.volume[i] || 0,
      })).filter((d: ChartData) => d.close > 0); // Filter out invalid data

      // Cache latest price
      if (chartData.length > 0) {
        this.priceCache.set(symbol, chartData[chartData.length - 1].close);
      }

      return chartData;
    } catch (error) {
      console.error('Error fetching chart data:', error);
      return this.generateFallbackData(symbol, interval, range);
    }
  }

  // Get current quote for a symbol
  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
      const params = {
        interval: '1m',
        range: '1d',
      };

      const response = await axios.get(url, { params });
      const result = response.data.chart.result[0];
      
      if (result && result.meta && result.meta.regularMarketPrice) {
        const price = result.meta.regularMarketPrice;
        this.priceCache.set(symbol, price);
        return price;
      }

      // Fallback to cached price
      return this.priceCache.get(symbol) || 0;
    } catch (error) {
      console.error('Error fetching current price:', error);
      return this.priceCache.get(symbol) || 0;
    }
  }

  // Fetch real options chain data
  async fetchOptionsChain(symbol: string, expirationDate?: string): Promise<OptionChain[]> {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
      const params = expirationDate ? { date: expirationDate } : {};

      const response = await axios.get(url, { params });
      const result = response.data.optionChain.result[0];

      if (!result || !result.options) {
        console.error('No options data for', symbol);
        return [];
      }

      const optionChains: OptionChain[] = result.options.map((opt: any) => ({
        expirationDate: new Date(opt.expirationDate * 1000).toISOString().split('T')[0],
        calls: opt.calls?.map((call: any) => ({
          strike: call.strike,
          lastPrice: call.lastPrice || 0,
          bid: call.bid || 0,
          ask: call.ask || 0,
          volume: call.volume || 0,
          openInterest: call.openInterest || 0,
          impliedVolatility: call.impliedVolatility || 0,
          inTheMoney: call.inTheMoney || false,
        })) || [],
        puts: opt.puts?.map((put: any) => ({
          strike: put.strike,
          lastPrice: put.lastPrice || 0,
          bid: put.bid || 0,
          ask: put.ask || 0,
          volume: put.volume || 0,
          openInterest: put.openInterest || 0,
          impliedVolatility: put.impliedVolatility || 0,
          inTheMoney: put.inTheMoney || false,
        })) || [],
      }));

      return optionChains;
    } catch (error) {
      console.error('Error fetching options chain:', error);
      return [];
    }
  }

  // Get available expiration dates for options
  async getOptionExpirations(symbol: string): Promise<string[]> {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
      const response = await axios.get(url);
      const result = response.data.optionChain.result[0];

      if (!result || !result.expirationDates) {
        return [];
      }

      return result.expirationDates.map((timestamp: number) => 
        new Date(timestamp * 1000).toISOString().split('T')[0]
      );
    } catch (error) {
      console.error('Error fetching expiration dates:', error);
      return [];
    }
  }

  // Subscribe to real-time price updates (polling-based for free API)
  subscribeToPrice(
    symbol: string,
    callback: (price: number) => void
  ): () => void {
    // Poll every 5 seconds for real-time updates
    const intervalId = setInterval(async () => {
      try {
        const price = await this.getCurrentPrice(symbol);
        if (price > 0) {
          callback(price);
        }
      } catch (error) {
        console.error('Error in price subscription:', error);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }

  // Fallback to simulated data if API fails
  private generateFallbackData(
    symbol: string,
    interval: string,
    range: string
  ): ChartData[] {
    console.warn(`Using fallback data for ${symbol}`);
    const data: ChartData[] = [];
    let basePrice = this.priceCache.get(symbol) || 100 + Math.random() * 100;
    
    const bars = this.getBarsForRange(range);
    const now = Date.now();
    const timeframeMs = this.getTimeframeMs(interval);

    for (let i = bars; i >= 0; i--) {
      const volatility = 0.02;
      const change = (Math.random() - 0.5) * 2 * volatility;
      const open = basePrice;
      const close = basePrice * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);
      const volume = Math.floor(1000000 + Math.random() * 5000000);

      data.push({
        time: now - i * timeframeMs,
        open,
        high,
        low,
        close,
        volume,
      });

      basePrice = close;
    }

    this.priceCache.set(symbol, basePrice);
    return data;
  }

  private getBarsForRange(range: string): number {
    const map: Record<string, number> = {
      '1d': 78,
      '5d': 390,
      '1mo': 500,
      '3mo': 1500,
      '6mo': 3000,
      '1y': 252,
      '2y': 504,
      '5y': 1260,
      'max': 2520,
    };
    return map[range] || 100;
  }

  private getTimeframeMs(timeframe: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '2m': 2 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '60m': 60 * 60 * 1000,
      '90m': 90 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '5d': 5 * 24 * 60 * 60 * 1000,
      '1wk': 7 * 24 * 60 * 60 * 1000,
      '1mo': 30 * 24 * 60 * 60 * 1000,
      '3mo': 90 * 24 * 60 * 60 * 1000,
    };
    return map[timeframe] || 60 * 1000;
  }
}
