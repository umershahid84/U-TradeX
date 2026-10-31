// Market data handlers shared by the Vercel serverless functions (api/*.ts) and the
// Vite dev server (see vite.config.ts). Backed by yahoo-finance2, which performs the
// cookie/crumb handshake Yahoo requires and works server-side without CORS limits.
import YahooFinanceModule from 'yahoo-finance2';

const YahooFinance: any = (YahooFinanceModule as any).default ?? YahooFinanceModule;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export interface ApiResult {
  status: number;
  body: unknown;
  cacheSeconds?: number;
}

type Query = Record<string, string | undefined>;

const DAY = 24 * 60 * 60 * 1000;

// Yahoo only serves intraday history for a limited window
const INTRADAY_MAX_DAYS: Record<string, number> = {
  '1m': 7,
  '2m': 59,
  '5m': 59,
  '15m': 59,
  '30m': 59,
  '90m': 59,
  '60m': 729,
  '1h': 729,
};

const RANGE_DAYS: Record<string, number> = {
  '1d': 5, // look back far enough to find the last session on weekends/holidays
  '5d': 8,
  '1mo': 31,
  '3mo': 92,
  '6mo': 183,
  '1y': 366,
  '2y': 731,
  '5y': 1827,
  '10y': 3653,
};

const nyDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const fail = (status: number, message: string): ApiResult => ({ status, body: { error: message } });

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function chart(q: Query): Promise<ApiResult> {
  const symbol = q.symbol?.trim();
  if (!symbol) return fail(400, 'symbol is required');
  const interval = q.interval || '5m';
  const range = q.range || '1d';
  const prepost = q.prepost === 'true';

  const now = Date.now();
  let period1: number;
  if (range === 'ytd') period1 = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  else if (range === 'max') period1 = 0;
  else period1 = now - (RANGE_DAYS[range] ?? 5) * DAY;

  const maxDays = INTRADAY_MAX_DAYS[interval];
  if (maxDays) period1 = Math.max(period1, now - maxDays * DAY);

  let result: any;
  try {
    result = await yf.chart(symbol, {
      period1: new Date(period1),
      interval,
      includePrePost: prepost,
    });
  } catch (e) {
    return fail(502, `Yahoo request failed for ${symbol}: ${errMessage(e)}`);
  }

  let bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let lastTime = 0;
  for (const b of result?.quotes ?? []) {
    if (b.open == null || b.high == null || b.low == null || b.close == null) continue;
    const time = new Date(b.date).getTime();
    if (time <= lastTime) continue;
    lastTime = time;
    bars.push({ time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });
  }

  // Trim the look-back window down to what was asked for
  if (bars.length && (range === '1d' || range === '5d')) {
    const days = [...new Set(bars.map((b) => nyDate(b.time)))];
    const keep = new Set(days.slice(-(range === '1d' ? 1 : 5)));
    bars = bars.filter((b) => keep.has(nyDate(b.time)));
  }

  if (!bars.length) return fail(404, `No data returned for ${symbol}`);
  return { status: 200, body: { symbol, bars }, cacheSeconds: 1 };
}

async function quote(q: Query): Promise<ApiResult> {
  const symbol = q.symbol?.trim();
  if (!symbol) return fail(400, 'symbol is required');
  const prepost = q.prepost === 'true';

  let r: any;
  try {
    r = await yf.quote(symbol);
  } catch (e) {
    return fail(502, `Yahoo request failed for ${symbol}: ${errMessage(e)}`);
  }

  // regularMarketPrice only reflects the regular session; use the extended-hours
  // price when the market is in (or after) that phase and the user asked for it.
  let price = r?.regularMarketPrice;
  if (prepost) {
    if (r?.marketState === 'PRE' && r.preMarketPrice) price = r.preMarketPrice;
    else if (['POST', 'POSTPOST', 'CLOSED'].includes(r?.marketState) && r.postMarketPrice) {
      price = r.postMarketPrice;
    }
  }
  if (!price || price <= 0) return fail(404, `No live price for ${symbol}`);

  return {
    status: 200,
    body: { symbol, price, marketState: r.marketState, timestamp: Date.now() },
    cacheSeconds: 1,
  };
}

async function optionExpirations(q: Query): Promise<ApiResult> {
  const symbol = q.symbol?.trim();
  if (!symbol) return fail(400, 'symbol is required');
  try {
    const r: any = await yf.options(symbol);
    const expirations = (r?.expirationDates ?? []).map((d: Date) => new Date(d).toISOString().split('T')[0]);
    return { status: 200, body: { expirations }, cacheSeconds: 60 };
  } catch (e) {
    return fail(502, `Yahoo request failed for ${symbol}: ${errMessage(e)}`);
  }
}

const contract = (c: any) => ({
  strike: c.strike ?? 0,
  lastPrice: c.lastPrice ?? 0,
  bid: c.bid ?? 0,
  ask: c.ask ?? 0,
  volume: c.volume ?? 0,
  openInterest: c.openInterest ?? 0,
  impliedVolatility: c.impliedVolatility ?? 0,
  inTheMoney: !!c.inTheMoney,
});

async function options(q: Query): Promise<ApiResult> {
  const symbol = q.symbol?.trim();
  if (!symbol) return fail(400, 'symbol is required');
  try {
    const r: any = await yf.options(symbol, q.date ? { date: new Date(q.date) } : {});
    const chains = (r?.options ?? []).map((o: any) => ({
      expirationDate: new Date(o.expirationDate).toISOString().split('T')[0],
      calls: (o.calls ?? []).map(contract),
      puts: (o.puts ?? []).map(contract),
    }));
    return { status: 200, body: { chains }, cacheSeconds: 10 };
  } catch (e) {
    return fail(502, `Yahoo request failed for ${symbol}: ${errMessage(e)}`);
  }
}

const routes: Record<string, (q: Query) => Promise<ApiResult>> = {
  chart,
  quote,
  options,
  'options/expirations': optionExpirations,
};

export async function route(path: string, query: Query): Promise<ApiResult> {
  const handler = routes[path.replace(/^\/+|\/+$/g, '')];
  if (!handler) return fail(404, `Unknown endpoint: ${path}`);
  return handler(query);
}
