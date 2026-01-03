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

export type TimeFrame = '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M' | '3M' | '1y';
export type TimeRange = 'today' | '1d' | '5d' | '1w' | '1y' | 'max';

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
