import { ChartData } from '../types';

// Simulated market data service
export class MarketDataService {
  private static instance: MarketDataService;
  private priceCache: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): MarketDataService {
    if (!MarketDataService.instance) {
      MarketDataService.instance = new MarketDataService();
    }
    return MarketDataService.instance;
  }

  // Generate simulated price data
  generateChartData(
    symbol: string,
    timeframe: string,
    bars: number = 100
  ): ChartData[] {
    const data: ChartData[] = [];
    let basePrice = this.priceCache.get(symbol) || 100 + Math.random() * 100;
    this.priceCache.set(symbol, basePrice);
    
    const now = Date.now();
    const timeframeMs = this.getTimeframeMs(timeframe);

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

  getCurrentPrice(symbol: string): number {
    return this.priceCache.get(symbol) || 100 + Math.random() * 100;
  }

  // Simulate live price updates
  subscribeToPrice(
    symbol: string,
    callback: (price: number) => void
  ): () => void {
    const interval = setInterval(() => {
      const currentPrice = this.getCurrentPrice(symbol);
      const change = (Math.random() - 0.5) * 0.01;
      const newPrice = currentPrice * (1 + change);
      this.priceCache.set(symbol, newPrice);
      callback(newPrice);
    }, 1000);

    return () => clearInterval(interval);
  }

  private getTimeframeMs(timeframe: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '2m': 2 * 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '10m': 10 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000,
      '3M': 90 * 24 * 60 * 60 * 1000,
      '1y': 365 * 24 * 60 * 60 * 1000,
    };
    return map[timeframe] || 60 * 1000;
  }
}
