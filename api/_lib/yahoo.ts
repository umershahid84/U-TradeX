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

async function chart(symbol: string, opts: { period1: Date | number; period2?: Date | number; interval?: string; includePrePost?: boolean }) {
  const json = await getJson(
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    {
      period1: epochSeconds(opts.period1),
      period2: epochSeconds(opts.period2 ?? Date.now()),
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

async function quote(symbols: string | string[], ..._rest: unknown[]) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const json = await getJson('/v7/finance/quote', { symbols: list.join(',') }, true);
  const result: any[] = (json?.quoteResponse?.result ?? []).map(withDates);
  return Array.isArray(symbols) ? result : result[0];
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
