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
  private static readonly PRICE_POLL_INTERVAL_MS = 1000; // Polling interval for price updates

  private constructor() {}

  static getInstance(): RealMarketDataService {
    if (!RealMarketDataService.instance) {
      RealMarketDataService.instance = new RealMarketDataService();
    }
    return RealMarketDataService.instance;
  }

  // Normalize symbol for Yahoo Finance API
  // SPX -> ^GSPC (S&P 500 Index)
  // ES -> ES=F (E-mini S&P 500 Futures)
  // NQ -> NQ=F (E-mini NASDAQ-100 Futures)
  private normalizeSymbol(symbol: string): string {
    const symbolMap: Record<string, string> = {
      // Indices
      'SPX': '^GSPC',
      'SPY': 'SPY',
      'QQQ': 'QQQ',
      'DIA': 'DIA',
      'IWM': 'IWM',
      'VIX': '^VIX',
      'DJI': '^DJI',
      'IXIC': '^IXIC',
      'RUT': '^RUT',
      'NDX': '^NDX',
      
      // Futures
      'ES': 'ES=F',   // E-mini S&P 500
      'NQ': 'NQ=F',   // E-mini NASDAQ-100
      'YM': 'YM=F',   // E-mini Dow
      'RTY': 'RTY=F', // E-mini Russell 2000
      'GC': 'GC=F',   // Gold Futures
      'SI': 'SI=F',   // Silver Futures
      'CL': 'CL=F',   // Crude Oil Futures
      'NG': 'NG=F',   // Natural Gas Futures
      'ZB': 'ZB=F',   // 30-Year T-Bond Futures
      'ZN': 'ZN=F',   // 10-Year T-Note Futures
    };
    
    const upperSymbol = symbol.toUpperCase();
    return symbolMap[upperSymbol] || symbol;
  }


  // Yahoo does not send CORS headers, so a browser cannot call it directly.
  // Try the Vite dev/preview proxy first (same-origin, most reliable), then the
  // public hosts, then CORS proxies.
  private async yahooGet(path: string, timeout = 8000): Promise<any> {
    const candidates = [
      `/api/yahoo/${path}`,
      `https://query1.finance.yahoo.com/${path}`,
      `https://query2.finance.yahoo.com/${path}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/${path}`)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://query1.finance.yahoo.com/${path}`)}`,
    ];
    let lastError: unknown;
    for (const url of candidates) {
      try {
        const response = await axios.get(url, { timeout, headers: { Accept: 'application/json' } });
        // Dev server returns index.html for unknown routes - skip non-JSON bodies
        if (response.data && typeof response.data === 'object') {
          return response.data;
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('All market data endpoints failed');
  }

  // Fetch real historical data from Yahoo Finance
  async fetchChartData(
    symbol: string,
    interval: string = '5m',
    range: string = '1d',
    includePrePost: boolean = false
  ): Promise<ChartData[]> {
    const yahooSymbol = encodeURIComponent(this.normalizeSymbol(symbol));
    const params = new URLSearchParams({
      interval,
      range,
      includePrePost: includePrePost ? 'true' : 'false',
    });

    const data = await this.yahooGet(`v8/finance/chart/${yahooSymbol}?${params.toString()}`, 10000);
    const result = data?.chart?.result?.[0];
    const quotes = result?.indicators?.quote?.[0];

    if (!result || !Array.isArray(result.timestamp) || !quotes) {
      throw new Error(`No market data returned for ${symbol}`);
    }

    // Skip bars with null OHLC (Yahoo returns nulls for empty intervals) rather than
    // inventing values. Also drop duplicate timestamps, which the chart rejects.
    const chartData: ChartData[] = [];
    result.timestamp.forEach((time: number, i: number) => {
      const { open, high, low, close, volume } = {
        open: quotes.open[i],
        high: quotes.high[i],
        low: quotes.low[i],
        close: quotes.close[i],
        volume: quotes.volume[i],
      };
      if (close == null || open == null || high == null || low == null) return;
      const ms = time * 1000;
      if (chartData.length && chartData[chartData.length - 1].time >= ms) return;
      chartData.push({ time: ms, open, high, low, close, volume: volume || 0 });
    });

    if (chartData.length === 0) {
      throw new Error(`Empty market data for ${symbol}`);
    }

    // Use the exchange's current price for the newest bar when available
    const meta = result.meta;
    const last = chartData[chartData.length - 1];
    if (meta?.regularMarketPrice && !includePrePost) {
      last.close = meta.regularMarketPrice;
      last.high = Math.max(last.high, last.close);
      last.low = Math.min(last.low, last.close);
    }

    this.priceCache.set(symbol, last.close);
    return chartData;
  }

  // Get current quote for a symbol. Throws if no live price could be fetched
  // (callers keep showing the last known real price instead of a made-up one).
  async getCurrentPrice(symbol: string, includePrePost: boolean = true): Promise<number> {
    const yahooSymbol = encodeURIComponent(this.normalizeSymbol(symbol));
    const params = new URLSearchParams({
      interval: '1m',
      range: '1d',
      includePrePost: includePrePost ? 'true' : 'false',
    });
    const data = await this.yahooGet(`v8/finance/chart/${yahooSymbol}?${params.toString()}`);
    const result = data?.chart?.result?.[0];

    // Prefer the latest 1m close when extended hours are on, since regularMarketPrice
    // only reflects the regular session.
    let price: number | undefined;
    if (includePrePost) {
      const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null) {
          price = closes[i] as number;
          break;
        }
      }
    }
    price = price ?? result?.meta?.regularMarketPrice;

    if (!price || price <= 0) {
      throw new Error(`No live price for ${symbol}`);
    }
    this.priceCache.set(symbol, price);
    return price;
  }

  // Fetch real options chain data
  async fetchOptionsChain(symbol: string, expirationDate?: string): Promise<OptionChain[]> {
    try {
      const params = expirationDate ? `?date=${expirationDate}` : '';
      
      const data = await this.yahooGet(`v7/finance/options/${symbol}${params}`);
      const result = data?.optionChain?.result?.[0];

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

      console.log(`✅ Fetched REAL options data for ${symbol}`);
      return optionChains;
    } catch (error) {
      console.error('Error fetching options chain:', error);
      return [];
    }
  }

  // Get available expiration dates for options
  async getOptionExpirations(symbol: string): Promise<string[]> {
    try {
      const data = await this.yahooGet(`v7/finance/options/${symbol}`);
      const result = data?.optionChain?.result?.[0];

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
    callback: (price: number) => void,
    includePrePost: boolean = false
  ): () => void {
    let isActive = true;
    let inFlight = false;

    const pollPrice = async () => {
      if (!isActive || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const price = await this.getCurrentPrice(symbol, includePrePost);
        if (isActive && price > 0) {
          callback(price);
        }
      } catch (error) {
        // Keep the last real price on screen; just retry on the next tick
        console.warn(`Live price fetch failed for ${symbol}`, error);
      } finally {
        inFlight = false;
      }
    };

    void pollPrice();
    const intervalId = setInterval(() => {
      void pollPrice();
    }, RealMarketDataService.PRICE_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }
}
