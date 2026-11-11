// Minimal Yahoo Finance client built on plain fetch (no dependencies). It replaces the much heavier
// yahoo-finance2 library so the API also runs within the tight CPU limits of Cloudflare Workers.
// It returns the same shapes market.ts used from that library (dates as Date objects).

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

type Session = { cookie: string; crumb: string; at: number };
let session: Session | null = null;
let pending: Promise<Session> | null = null;
const SESSION_TTL = 60 * 60 * 1000;

class YahooError extends Error {}

const cookieHeader = (res: Response): string => {
  const raw: string[] =
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_]+=)/);
  return raw
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

// Yahoo's quote and options endpoints need a cookie plus a "crumb" token obtained with it
async function newSession(): Promise<Session> {
  const first = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookie = cookieHeader(first);
  if (!cookie) throw new YahooError('Yahoo did not hand out a session cookie');
  let lastStatus = 0;
  for (const host of HOSTS) {
    const res = await fetch(`${host}/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie } });
    lastStatus = res.status;
    const crumb = (await res.text()).trim();
    if (res.ok && crumb && !crumb.includes('<') && crumb.length < 64) return { cookie, crumb, at: Date.now() };
  }
  throw new YahooError(`Yahoo crumb request failed (${lastStatus})`);
}

const getSession = async (fresh = false): Promise<Session> => {
  if (!fresh && session && Date.now() - session.at < SESSION_TTL) return session;
  pending ??= newSession()
    .then((s) => (session = s))
    .finally(() => {
      pending = null;
    });
  return pending;
};

async function getJson(path: string, params: Record<string, string | number | boolean | undefined>, needsCrumb: boolean): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = needsCrumb ? await getSession(attempt > 0) : null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    if (s) qs.set('crumb', s.crumb);
    for (const host of HOSTS) {
      try {
        const res = await fetch(`${host}${path}?${qs}`, {
          headers: { 'User-Agent': UA, Accept: 'application/json', ...(s ? { Cookie: s.cookie } : {}) },
        });
        if (res.status === 401 || res.status === 403) {
          lastError = new YahooError(`Yahoo refused the request (${res.status})`);
          break; // new session on the next attempt
        }
        if (res.status === 404) throw new YahooError('Symbol not found');
        if (res.status === 429) throw new YahooError('Yahoo is rate limiting requests (Too Many Requests)');
        if (!res.ok) {
          lastError = new YahooError(`Yahoo responded ${res.status}`);
          continue;
        }
        return await res.json();
      } catch (e) {
        lastError = e;
        if (e instanceof YahooError && /not found|rate limiting/i.test(e.message)) throw e;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new YahooError('Yahoo request failed');
}

const epochSeconds = (d: Date | number) => Math.floor((d instanceof Date ? d.getTime() : d) / 1000);

// Yahoo sends times in epoch seconds; callers expect Dates
const withDates = (o: any) => {
  for (const k of Object.keys(o)) if (/Time$/.test(k) && typeof o[k] === 'number') o[k] = new Date(o[k] * 1000);
  return o;
};

async function chart(symbol: string, opts: { period1?: Date | number; period2?: Date | number; range?: string; interval?: string; includePrePost?: boolean }) {
  const json = await getJson(
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    {
      ...(opts.range
        ? { range: opts.range }
        : { period1: epochSeconds(opts.period1 ?? 0), period2: epochSeconds(opts.period2 ?? Date.now()) }),
      interval: opts.interval ?? '1d',
      includePrePost: opts.includePrePost ?? false,
    },
    false
  );
  const r = json?.chart?.result?.[0];
  if (!r) throw new YahooError(json?.chart?.error?.description ?? 'No data returned');
  const q = r.indicators?.quote?.[0] ?? {};
  const ts: number[] = r.timestamp ?? [];
  const quotes = ts.map((t, i) => ({
    date: new Date(t * 1000),
    open: q.open?.[i] ?? null,
    high: q.high?.[i] ?? null,
    low: q.low?.[i] ?? null,
    close: q.close?.[i] ?? null,
    volume: q.volume?.[i] ?? null,
  }));
  return { meta: r.meta, quotes };
}

// Quote built from the chart endpoint, which needs no cookie or crumb. Used when the crumb handshake is
// refused (it can be from some hosts' IP ranges): live price, change and the pre-market / after-hours
// moves all come from the latest bars.
async function quoteFromChart(symbol: string): Promise<any | null> {
  const { meta, quotes } = await chart(symbol, { range: '1d', interval: '5m', includePrePost: true });
  if (!meta) return null;
  const nowS = Date.now() / 1000;
  const tp = meta.currentTradingPeriod ?? {};
  const pre = tp.pre, reg = tp.regular, post = tp.post;
  const prevClose: number | null = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const regPrice: number | null = meta.regularMarketPrice ?? null;
  const lastIn = (from?: number, to?: number) => {
    if (from == null || to == null) return null;
    for (let i = quotes.length - 1; i >= 0; i--) {
      const t = quotes[i].date.getTime() / 1000;
      if (t >= from && t < to && quotes[i].close != null) return { price: quotes[i].close as number, time: quotes[i].date };
    }
    return null;
  };
  const preBar = lastIn(pre?.start, pre?.end);
  const postBar = lastIn(post?.start, post?.end);
  const ratio = (v: number | null, base: number | null) => (v != null && base ? (v / base) * 100 : null);

  let marketState = 'CLOSED';
  if (reg && nowS >= reg.start && nowS < reg.end) marketState = 'REGULAR';
  else if (pre && nowS >= pre.start && nowS < pre.end) marketState = 'PRE';
  else if (post && nowS >= post.start && nowS < post.end) marketState = 'POST';
  else if (pre && nowS < pre.start) marketState = 'PREPRE';
  else if (post && nowS >= post.end) marketState = 'POSTPOST';

  const change = regPrice != null && prevClose != null ? regPrice - prevClose : null;
  return {
    symbol: meta.symbol ?? symbol,
    shortName: meta.shortName ?? meta.longName ?? symbol,
    marketState,
    regularMarketPrice: regPrice,
    regularMarketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : undefined,
    regularMarketPreviousClose: prevClose,
    regularMarketChange: change,
    regularMarketChangePercent: ratio(change, prevClose),
    preMarketPrice: preBar?.price ?? null,
    preMarketTime: preBar?.time,
    preMarketChange: preBar && prevClose != null ? preBar.price - prevClose : null,
    preMarketChangePercent: preBar ? ratio(preBar.price - (prevClose ?? 0), prevClose) : null,
    postMarketPrice: postBar?.price ?? null,
    postMarketTime: postBar?.time,
    postMarketChange: postBar && regPrice != null ? postBar.price - regPrice : null,
    postMarketChangePercent: postBar && regPrice != null ? ratio(postBar.price - regPrice, regPrice) : null,
  };
}

async function quote(symbols: string | string[], ..._rest: unknown[]) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  try {
    const json = await getJson('/v7/finance/quote', { symbols: list.join(',') }, true);
    const result: any[] = (json?.quoteResponse?.result ?? []).map(withDates);
    return Array.isArray(symbols) ? result : result[0];
  } catch (firstError) {
    // no crumb available: rebuild the quotes from chart data instead
    const built = await Promise.all(list.map((s) => quoteFromChart(s).catch(() => null)));
    const ok = built.filter((q): q is any => q !== null);
    if (!ok.length) throw firstError;
    return Array.isArray(symbols) ? ok : ok[0];
  }
}

async function options(symbol: string, opts: { date?: Date } = {}, ..._rest: unknown[]) {
  const json = await getJson(
    `/v7/finance/options/${encodeURIComponent(symbol)}`,
    { date: opts.date ? epochSeconds(opts.date) : undefined },
    true
  );
  const r = json?.optionChain?.result?.[0];
  if (!r) throw new YahooError(json?.optionChain?.error?.description ?? 'No options data returned');
  return {
    expirationDates: (r.expirationDates ?? []).map((t: number) => new Date(t * 1000)),
    options: (r.options ?? []).map((o: any) => ({ ...o, expirationDate: new Date(o.expirationDate * 1000) })),
  };
}

export const yf = { chart, quote, options };

/** Step-by-step check of the Yahoo connection, for /api/health (no secrets: the crumb is not shown) */
export async function diagnose() {
  const steps: Record<string, unknown> = {};
  const run = async (name: string, fn: () => Promise<Record<string, unknown>>) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps[name] = { ok: true, ms: Date.now() - t0, ...detail };
    } catch (e) {
      steps[name] = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
    }
  };
  let cookie = '';
  await run('cookie (fc.yahoo.com)', async () => {
    const res = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
    cookie = cookieHeader(res);
    return { status: res.status, gotCookie: !!cookie };
  });
  await run('crumb (getcrumb)', async () => {
    const res = await fetch(`${HOSTS[0]}/v1/test/getcrumb`, { headers: { 'User-Agent': UA, Cookie: cookie } });
    const text = (await res.text()).trim();
    return { status: res.status, crumbLength: text.length, looksLikeHtml: text.includes('<'), body: text.length > 40 ? text.slice(0, 120) : undefined };
  });
  await run('chart (no crumb needed)', async () => {
    const c = await chart('AAPL', { period1: Date.now() - 5 * 86400000, interval: '1d' });
    return { bars: c.quotes.length };
  });
  await run('quote', async () => {
    const q: any = await quote('AAPL');
    return { price: q?.regularMarketPrice };
  });
  await run('options', async () => {
    const o = await options('AAPL');
    return { expirations: o.expirationDates.length, chains: o.options.length };
  });
  return steps;
}
