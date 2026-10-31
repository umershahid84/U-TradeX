import axios from 'axios';
import { ChartData, MarketFearGreed } from '../types';

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

export interface QuoteDetails {
  price: number;
  marketState: string;
  regularPrice: number | null;
  regularChange: number | null;
  regularChangePercent: number | null;
  previousClose: number | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketChangePercent: number | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketChangePercent: number | null;
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


  // Market data comes from the /api serverless functions (api/_lib/market.ts), served by
  // Vercel in production and by Vite in dev. Browsers cannot call Yahoo directly.
  private async apiGet<T>(path: string, params: Record<string, string>, timeout = 15000): Promise<T> {
    try {
      const response = await axios.get<T>(`/api/${path}`, { params, timeout });
      if (!response.data || typeof response.data !== 'object') {
        throw new Error('Market data server is not running (try again shortly)');
      }
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.error;
        throw new Error(detail || 'Market data server unreachable (try again shortly)');
      }
      throw error;
    }
  }

  // Fetch real historical data from Yahoo Finance
  async fetchChartData(
    symbol: string,
    interval: string = '5m',
    range: string = '1d',
    includePrePost: boolean = false
  ): Promise<ChartData[]> {
    const data = await this.apiGet<{ bars: ChartData[] }>('chart', {
      symbol: this.normalizeSymbol(symbol),
      interval,
      range,
      prepost: String(includePrePost),
    });

    if (!Array.isArray(data.bars) || data.bars.length === 0) {
      throw new Error(`No market data returned for ${symbol}`);
    }

    this.priceCache.set(symbol, data.bars[data.bars.length - 1].close);
    return data.bars;
  }

  // Get current quote for a symbol. Throws if no live price could be fetched
  // (callers keep showing the last known real price instead of a made-up one).
  async getCurrentPrice(symbol: string, includePrePost: boolean = true): Promise<number> {
    const data = await this.apiGet<{ price: number }>('quote', {
      symbol: this.normalizeSymbol(symbol),
      prepost: String(includePrePost),
    }, 8000);

    if (!data.price || data.price <= 0) {
      throw new Error(`No live price for ${symbol}`);
    }
    this.priceCache.set(symbol, data.price);
    return data.price;
  }

  // Regular-session close plus pre-market / after-hours moves for the header
  async getQuoteDetails(symbol: string): Promise<QuoteDetails> {
    return this.apiGet<QuoteDetails>('quote', { symbol: this.normalizeSymbol(symbol), prepost: 'true' }, 8000);
  }

  // Market-wide Fear & Greed index (CNN's, or an estimate if CNN is unreachable)
  async getMarketFearGreed(): Promise<MarketFearGreed> {
    return this.apiGet<MarketFearGreed>('feargreed', {}, 15000);
  }

  // Fetch real options chain data
  async fetchOptionsChain(symbol: string, expirationDate?: string): Promise<OptionChain[]> {
    try {
      const params: Record<string, string> = { symbol: this.normalizeSymbol(symbol) };
      if (expirationDate) params.date = expirationDate;
      const data = await this.apiGet<{ chains: OptionChain[] }>('options', params);
      return data.chains ?? [];
    } catch (error) {
      console.error('Error fetching options chain:', error);
      return [];
    }
  }

  // Get available expiration dates for options
  async getOptionExpirations(symbol: string): Promise<string[]> {
    try {
      const data = await this.apiGet<{ expirations: string[] }>('options/expirations', {
        symbol: this.normalizeSymbol(symbol),
      });
      return data.expirations ?? [];
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
