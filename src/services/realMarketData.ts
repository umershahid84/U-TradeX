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
    let basePrice = this.priceCache.get(symbol) || this.getRealisticPrice(symbol);
    
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

  // Get realistic starting price based on symbol
  private getRealisticPrice(symbol: string): number {
    // Common stock/crypto prices (approximate realistic values)
    const priceMap: Record<string, number> = {
      // Major stocks
      'AAPL': 175,
      'MSFT': 380,
      'GOOGL': 140,
      'GOOG': 142,
      'AMZN': 155,
      'TSLA': 250,
      'META': 485,
      'NVDA': 495,
      'AMD': 155,
      'INTC': 45,
      'NFLX': 480,
      'DIS': 95,
      'BA': 180,
      'JPM': 200,
      'V': 280,
      'MA': 460,
      'WMT': 75,
      'JNJ': 150,
      'PG': 165,
      'KO': 62,
      'PEP': 170,
      'COST': 880,
      'HD': 390,
      'NKE': 80,
      'MCD': 295,
      'SBUX': 98,
      'IBM': 190,
      'ORCL': 145,
      'CRM': 310,
      'ADBE': 480,
      'PYPL': 78,
      'SQ': 75,
      'SHOP': 82,
      'UBER': 68,
      'LYFT': 12,
      'SNAP': 11,
      'PINS': 32,
      'TWTR': 53,
      'SPOT': 350,
      'ROKU': 68,
      'ZM': 71,
      'DOCU': 58,
      'CRWD': 340,
      'ZS': 195,
      'OKTA': 100,
      'DDOG': 125,
      'SNOW': 155,
      'MDB': 410,
      'TEAM': 210,
      'PANW': 350,
      'FTNT': 73,
      'NET': 88,
      'DKNG': 42,
      'PENN': 20,
      'MGM': 43,
      'WYNN': 95,
      'LVS': 42,
      
      // Crypto (in USD)
      'BTC': 42000,
      'BTC-USD': 42000,
      'ETH': 2200,
      'ETH-USD': 2200,
      'DOGE': 0.08,
      'DOGE-USD': 0.08,
      'ADA': 0.50,
      'ADA-USD': 0.50,
      'SOL': 100,
      'SOL-USD': 100,
      'MATIC': 0.85,
      'MATIC-USD': 0.85,
      'DOT': 7.5,
      'DOT-USD': 7.5,
      'LINK': 14,
      'LINK-USD': 14,
      'UNI': 6,
      'UNI-USD': 6,
      'AVAX': 36,
      'AVAX-USD': 36,
    };
    
    // Check if symbol is in the map
    const upperSymbol = symbol.toUpperCase();
    if (priceMap[upperSymbol]) {
      return priceMap[upperSymbol];
    }
    
    // If not found, return a reasonable default based on symbol characteristics
    // Crypto symbols typically end with -USD or are 3-4 letters
    if (upperSymbol.endsWith('-USD') || (upperSymbol.length <= 4 && !upperSymbol.match(/^[A-Z]{1,5}$/))) {
      return 1000 + Math.random() * 9000; // Random crypto-like price (1k-10k)
    }
    
    // Default to typical stock price range
    return 50 + Math.random() * 150; // Random stock price (50-200)
  }
}
