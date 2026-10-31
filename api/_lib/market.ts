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

  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    status: 200,
    body: {
      symbol,
      price,
      marketState: r.marketState,
      timestamp: Date.now(),
      regularPrice: n(r.regularMarketPrice),
      regularChange: n(r.regularMarketChange),
      regularChangePercent: n(r.regularMarketChangePercent),
      previousClose: n(r.regularMarketPreviousClose),
      preMarketPrice: n(r.preMarketPrice),
      preMarketChange: n(r.preMarketChange),
      preMarketChangePercent: n(r.preMarketChangePercent),
      postMarketPrice: n(r.postMarketPrice),
      postMarketChange: n(r.postMarketChange),
      postMarketChangePercent: n(r.postMarketChangePercent),
    },
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

// ---- Market-wide Fear & Greed ----
export interface FearGreedComponent { name: string; score: number; rating: string }
export interface MarketFearGreed {
  score: number;
  rating: string;
  previousClose: number | null;
  previousWeek: number | null;
  previousMonth: number | null;
  previousYear: number | null;
  updated: string;
  source: 'cnn' | 'estimate';
  components: FearGreedComponent[];
}

const fgRating = (score: number) =>
  score < 25 ? 'extreme fear' : score < 45 ? 'fear' : score < 55 ? 'neutral' : score < 75 ? 'greed' : 'extreme greed';

const CNN_COMPONENTS: Record<string, string> = {
  market_momentum_sp500: 'Market momentum',
  stock_price_strength: 'Stock price strength',
  stock_price_breadth: 'Stock price breadth',
  put_call_options: 'Put/call options',
  market_volatility_vix: 'Volatility (VIX)',
  junk_bond_demand: 'Junk bond demand',
  safe_haven_demand: 'Safe haven demand',
};

// CNN's index, which is the one people mean by "Fear & Greed". It is an unofficial endpoint, so
// it can be blocked or change; the caller falls back to an estimate.
async function fetchCnnFearGreed(): Promise<MarketFearGreed> {
  const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Referer: 'https://www.cnn.com/',
      Origin: 'https://www.cnn.com',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`CNN returned ${res.status}`);
  const d: any = await res.json();
  const fg = d?.fear_and_greed;
  if (!fg || typeof fg.score !== 'number') throw new Error('Unexpected CNN response');
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    score: fg.score,
    rating: String(fg.rating ?? fgRating(fg.score)).toLowerCase(),
    previousClose: num(fg.previous_close),
    previousWeek: num(fg.previous_1_week),
    previousMonth: num(fg.previous_1_month),
    previousYear: num(fg.previous_1_year),
    updated: fg.timestamp,
    source: 'cnn',
    components: Object.entries(CNN_COMPONENTS)
      .filter(([k]) => typeof d[k]?.score === 'number')
      .map(([k, name]) => ({ name, score: d[k].score, rating: String(d[k].rating ?? fgRating(d[k].score)).toLowerCase() })),
  };
}

// Rough stand-in built from Yahoo data when CNN is unreachable. Same idea as CNN's index
// (volatility, momentum, safe haven and junk bond demand) but fewer inputs, so it will not match.
async function estimateFearGreed(): Promise<MarketFearGreed> {
  const daily = async (symbol: string): Promise<number[]> => {
    const r: any = await yf.chart(symbol, { period1: new Date(Date.now() - 400 * DAY), interval: '1d' });
    return (r?.quotes ?? []).map((q: any) => q.close).filter((c: unknown) => typeof c === 'number');
  };
  const [vix, spx, spy, tlt, hyg, ief] = await Promise.all(
    ['^VIX', '^GSPC', 'SPY', 'TLT', 'HYG', 'IEF'].map(daily)
  );
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const clamp = (x: number) => Math.max(-1, Math.min(1, x));
  const ret = (a: number[], n: number) => a[a.length - 1] / a[a.length - 1 - n] - 1;
  const at = (x: number) => Math.round((50 + clamp(x) * 50) * 10) / 10;

  const parts: FearGreedComponent[] = [
    { name: 'Volatility (VIX)', score: at(-((vix[vix.length - 1] - mean(vix.slice(-50))) / mean(vix.slice(-50))) / 0.4) },
    { name: 'Market momentum', score: at((spx[spx.length - 1] / mean(spx.slice(-125)) - 1) / 0.1) },
    { name: 'Safe haven demand', score: at((ret(spy, 20) - ret(tlt, 20)) / 0.08) },
    { name: 'Junk bond demand', score: at((ret(hyg, 20) - ret(ief, 20)) / 0.04) },
  ].map((p) => ({ ...p, rating: fgRating(p.score) }));

  const score = Math.round(mean(parts.map((p) => p.score)) * 10) / 10;
  return {
    score,
    rating: fgRating(score),
    previousClose: null,
    previousWeek: null,
    previousMonth: null,
    previousYear: null,
    updated: new Date().toISOString(),
    source: 'estimate',
    components: parts,
  };
}

async function feargreed(): Promise<ApiResult> {
  try {
    return { status: 200, body: await fetchCnnFearGreed(), cacheSeconds: 120 };
  } catch (cnnError) {
    try {
      return { status: 200, body: await estimateFearGreed(), cacheSeconds: 120 };
    } catch (e) {
      return fail(502, `Fear & Greed unavailable (${errMessage(cnnError)}; ${errMessage(e)})`);
    }
  }
}

const routes: Record<string, (q: Query) => Promise<ApiResult>> = {
  feargreed,
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
