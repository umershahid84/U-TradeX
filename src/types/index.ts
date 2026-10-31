export interface Ticker {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface Order {
  id: string;
  symbol: string;
  type: 'market' | 'limit';
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled';
  timestamp: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface OptionContract {
  symbol: string;
  type: 'call' | 'put';
  strike: number;
  expiry: string;
  premium: number;
  quantity: number;
  /** Implied volatility when bought, used to estimate the current value */
  impliedVolatility?: number;
  /** Latest estimated value per share; falls back to the purchase premium */
  currentPremium?: number;
}

export interface PaperTradingAccount {
  balance: number;
  initialBalance: number;
  positions: Position[];
  orders: Order[];
  options: OptionContract[];
  totalValue: number;
  pnl: number;
  pnlPercent: number;
}

export interface TakeProfitStopLoss {
  symbol: string;
  takeProfit?: number;
  stopLoss?: number;
}

export interface FearGreedData {
  value: number; // 0-100
  level: 'extreme fear' | 'fear' | 'neutral' | 'greed' | 'extreme greed';
  signal: 'STRONG BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG SELL';
  oversold: boolean;
  overbought: boolean;
}

export interface MarketFearGreed {
  score: number; // 0-100
  rating: string;
  previousClose: number | null;
  previousWeek: number | null;
  previousMonth: number | null;
  previousYear: number | null;
  updated: string;
  /** 'cnn' is CNN's published index; 'estimate' is a rougher stand-in when CNN is unreachable */
  source: 'cnn' | 'estimate';
  components: { name: string; score: number; rating: string }[];
}

export type TimeFrame = '1s' | '5s' | '10s' | '30s' | '1m' | '2m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | 'D' | 'W' | 'M' | '1Q' | '1Y';
export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';

export interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicator {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  settings: Record<string, any>;
}

export type CustomIndicatorLanguage = 'pine' | 'js';

export interface CustomIndicator {
  id: string;
  name: string;
  language: CustomIndicatorLanguage;
  /** Pine Script source, or a JavaScript expression returning an array (language 'js') */
  source: string;
  /** Line colour / width, used by JavaScript indicators (Pine scripts set their own) */
  color: string;
  lineWidth: number;
  enabled: boolean;
  /** Overrides for Pine input() values, keyed by input id */
  inputValues?: Record<string, number | boolean | string>;
}

export interface CustomIndicatorStatus {
  error?: string;
  errorLine?: number;
  warnings: string[];
  inputs: import('../pine').PineInput[];
}

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  /** Fires when the price rises to the level ('above') or falls to it ('below') */
  direction: 'above' | 'below';
  createdAt: number;
  triggeredAt?: number;
  triggeredPrice?: number;
}

export interface Toast {
  id: string;
  title: string;
  body: string;
  symbol?: string;
}
