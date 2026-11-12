// Local-only live market data from your own Moomoo account, through the OpenD gateway on this computer.
//
// READ-ONLY BY DESIGN: this code never builds a trade request, and the connection refuses to send anything
// except the quote commands in transport.ts (ALLOWED_CMDS), so even a bug cannot place an order. Orders in
// this app are paper orders; nothing here can touch real money.
//
// Used only by the Vite dev server (vite.config.ts). It is not part of the Vercel build.
import { sessionAt, Session } from '../src/utils/marketSessions';
import type { ApiResult } from '../api/_lib/market';
import { QuoteTransport, TcpTransport, WsTransport, errText, ALLOWED_CMDS } from './transport';

export { ALLOWED_CMDS };

export interface MoomooConfig {
  host: string;
  port: number;
  /** 'tcp' = OpenD's API port (11111 by default); 'ws' = its WebSocket port (33333 by default) */
  protocol?: 'tcp' | 'ws';
  /** The WebSocket key set in OpenD (ws only) */
  key?: string;
  ssl?: boolean;
  /** Never fall back to Yahoo for quotes: show an error instead of delayed prices */
  only?: boolean;
}

const US_MARKET = 11; // Qot_Common.QotMarket_US_Security
const SUB_BASIC = 1; // Qot_Common.SubType_Basic
const MAX_SUBSCRIPTIONS = 60;
const RETRY_AFTER_FAILURE_MS = 15000;

type Query = Record<string, string | undefined>;

// Yahoo-style index symbols the app uses -> Moomoo US index codes
const INDEX_CODES: Record<string, string> = { '^GSPC': '.SPX', '^DJI': '.DJI', '^IXIC': '.IXIC', '^VIX': '.VIX' };

/** App symbols the US feed can serve: plain tickers (BRK-B becomes BRK.B) and the main indices. Futures use Yahoo. */
export const toMoomooCode = (symbol: string): string | null => {
  const s = symbol.trim().toUpperCase();
  if (INDEX_CODES[s]) return INDEX_CODES[s];
  return /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(s) ? s.replace('-', '.') : null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);

interface Ext {
  price?: number | null;
  changeVal?: number | null;
  changeRate?: number | null;
}

// session order across a trading day; to find "the latest price" walk backwards from the current session
const CYCLE: Session[] = ['overnight', 'pre', 'regular', 'post'];

/** The most recent price: the current session's own price if there is one, otherwise the previous session's */
export const pickPrice = (
  b: { curPrice?: number | null; preMarket?: Ext | null; afterMarket?: Ext | null; overnight?: Ext | null },
  session: Session
): number | null => {
  const byName: Record<string, number | null> = {
    overnight: num(b.overnight?.price),
    pre: num(b.preMarket?.price),
    regular: num(b.curPrice),
    post: num(b.afterMarket?.price),
  };
  let i = CYCLE.indexOf(session === 'closed' ? 'post' : session);
  for (let n = 0; n < CYCLE.length; n++, i = (i + CYCLE.length - 1) % CYCLE.length) {
    const p = byName[CYCLE[i]];
    if (p !== null) return p;
  }
  return null;
};

/** One BasicQot from OpenD, shaped like the /api/quote response */
export const toQuoteBody = (symbol: string, b: any, prepost: boolean, now = Date.now()) => {
  const session = sessionAt(now);
  const regular = num(b.curPrice);
  const prev = num(b.lastClosePrice);
  const pre = b.preMarket as Ext | undefined;
  const post = b.afterMarket as Ext | undefined;
  const night = b.overnight as Ext | undefined;
  const price = prepost ? pickPrice(b, session) : regular;
  const state: Record<Session, string> = { regular: 'REGULAR', pre: 'PRE', post: 'POST', overnight: 'OVERNIGHT', closed: 'CLOSED' };
  return {
    symbol,
    price,
    marketState: state[session],
    timestamp: now,
    source: 'moomoo' as const,
    regularPrice: regular,
    regularChange: regular !== null && prev !== null ? regular - prev : null,
    regularChangePercent: regular !== null && prev ? ((regular - prev) / prev) * 100 : null,
    previousClose: prev,
    preMarketPrice: num(pre?.price),
    preMarketChange: num(pre?.price) !== null ? num(pre?.changeVal) ?? 0 : null,
    preMarketChangePercent: num(pre?.price) !== null ? num(pre?.changeRate) ?? 0 : null,
    postMarketPrice: num(post?.price),
    postMarketChange: num(post?.price) !== null ? num(post?.changeVal) ?? 0 : null,
    postMarketChangePercent: num(post?.price) !== null ? num(post?.changeRate) ?? 0 : null,
    overnightPrice: num(night?.price),
    overnightChange: num(night?.price) !== null ? num(night?.changeVal) ?? 0 : null,
    overnightChangePercent: num(night?.price) !== null ? num(night?.changeRate) ?? 0 : null,
  };
};

// ---- candles ----
// API interval -> OpenD candle type (Qot_Common.KLType) and subscription type (SubType)
const KL: Record<string, { klType: number; subType: number; ms: number }> = {
  '1m': { klType: 1, subType: 11, ms: 60_000 },
  '5m': { klType: 6, subType: 7, ms: 300_000 },
  '15m': { klType: 7, subType: 8, ms: 900_000 },
  '30m': { klType: 8, subType: 9, ms: 1_800_000 },
  '60m': { klType: 9, subType: 10, ms: 3_600_000 },
  '1h': { klType: 9, subType: 10, ms: 3_600_000 },
};

const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const nyParts = (ms: number) => {
  const p: Record<string, number> = {};
  nyFmt.formatToParts(new Date(ms)).forEach((x) => x.type !== 'literal' && (p[x.type] = +x.value));
  return p;
};
const nyDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** "2026-11-11 09:35:00" (New York time) -> epoch ms */
export const etToMs = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const offset = (t: number) => {
    const p = nyParts(t);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  return guess - offset(guess - offset(guess));
};

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export const klToBars = (list: any[]): Bar[] =>
  (list ?? [])
    .filter((k) => !k.isBlank && k.openPrice != null && k.closePrice != null && k.highPrice != null && k.lowPrice != null)
    .map((k) => ({
      time: typeof k.timestamp === 'number' && k.timestamp > 0 ? Math.round(k.timestamp * 1000) : etToMs(String(k.time)),
      open: k.openPrice,
      high: k.highPrice,
      low: k.lowPrice,
      close: k.closePrice,
      volume: Number(String(k.volume ?? 0)),
    }))
    .filter((b) => Number.isFinite(b.time))
    .sort((a, b) => a.time - b.time);

/**
 * Lay Moomoo's recent candles over the history from Yahoo (which lags by about 15 minutes). Moomoo may label a
 * candle by its end rather than its start, so line the two feeds up by checking which alignment matches
 * the prices both of them have.
 */
export const mergeBars = (yahoo: Bar[], mm: Bar[], ivMs: number): Bar[] => {
  if (!mm.length) return yahoo;
  const yBy = new Map(yahoo.map((b) => [b.time, b]));
  const score = (shift: number) => {
    let sum = 0, n = 0;
    for (const b of mm.slice(0, -2)) {
      const y = yBy.get(b.time + shift);
      if (y) {
        sum += Math.abs(y.close - b.close) / (y.close || 1);
        n++;
      }
    }
    return { avg: n ? sum / n : Infinity, n };
  };
  const end = score(-ivMs), start = score(0);
  // no overlap to compare: assume candles are labelled by their end time
  const shift = start.n >= 3 && start.avg < end.avg ? 0 : -ivMs;
  const first = yahoo.length ? yahoo[0].time : -Infinity;
  const out = new Map(yBy);
  for (const b of mm) {
    const t = b.time + shift;
    if (t >= first) out.set(t, { ...b, time: t });
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
};

/** Same trimming the main API does for 1d / 5d ranges: keep only the last N New York trading days */
const trimDays = (bars: Bar[], range: string): Bar[] => {
  if (!bars.length || (range !== '1d' && range !== '5d')) return bars;
  const days = [...new Set(bars.map((b) => nyDate(b.time)))];
  const keep = new Set(days.slice(-(range === '1d' ? 1 : 5)));
  return bars.filter((b) => keep.has(nyDate(b.time)));
};

/** Connection to OpenD that can only ask for market data */
export class MoomooQuoteClient {
  private t: QuoteTransport | null = null;
  private starting: Promise<void> | null = null;
  private subscribed = new Set<string>();
  private subscribedOn: QuoteTransport | null = null;
  private downUntil = 0;
  /** Why the connection failed (cleared on success) */
  lastError = '';
  /** Last symbol OpenD would not serve (bad code, or no quote rights) */
  note = '';

  constructor(private cfg: MoomooConfig, private makeTransport?: (cfg: MoomooConfig) => QuoteTransport) {}

  get connected(): boolean {
    return !!this.t?.connected;
  }
  get subscriptionCount(): number {
    return this.subscribed.size;
  }

  private create(): QuoteTransport {
    if (this.makeTransport) return this.makeTransport(this.cfg);
    return this.cfg.protocol === 'ws' ? new WsTransport(this.cfg) : new TcpTransport(this.cfg);
  }

  private async ensure(): Promise<QuoteTransport> {
    if (this.t?.connected) return this.t;
    if (Date.now() < this.downUntil) throw new Error(this.lastError || 'OpenD unavailable');
    this.starting ??= (async () => {
      const t = this.create();
      try {
        await t.start();
        this.t = t;
        this.lastError = '';
      } catch (e) {
        this.lastError = errText(e);
        this.downUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
        t.close();
        this.t = null;
        throw e;
      }
    })().finally(() => {
      this.starting = null;
    });
    await this.starting;
    return this.t!;
  }

  private securities(codes: string[]) {
    return codes.map((code) => ({ market: US_MARKET, code }));
  }

  /** Subscribe to `subType` for the codes; returns the codes that are now subscribed */
  private async subscribe(t: QuoteTransport, codes: string[], subType: number, extended = false): Promise<string[]> {
    if (this.subscribedOn !== t) {
      this.subscribed.clear(); // subscriptions belong to a connection
      this.subscribedOn = t;
    }
    const key = (c: string) => `${c}|${subType}|${extended ? 1 : 0}`;
    const need = codes.filter((c) => !this.subscribed.has(key(c)));
    const take = need.slice(0, Math.max(0, MAX_SUBSCRIPTIONS - this.subscribed.size));
    const sub = (list: string[]) =>
      t.Sub({
        c2s: { securityList: this.securities(list), subTypeList: [subType], isSubOrUnSub: true, isRegOrUnRegPush: false, ...(extended ? { extendedTime: true } : {}) },
      });
    if (take.length) {
      try {
        await sub(take);
        take.forEach((c) => this.subscribed.add(key(c)));
      } catch {
        // one bad code fails the batch: find the good ones
        for (const c of take) {
          try {
            await sub([c]);
            this.subscribed.add(key(c));
          } catch (single) {
            this.note = `${c}: ${errText(single)}`;
          }
        }
      }
    }
    return codes.filter((c) => this.subscribed.has(key(c)));
  }

  /** Basic quotes by moomoo code; codes OpenD can't serve are left out */
  async quotes(codes: string[]): Promise<Map<string, any>> {
    const t = await this.ensure();
    const live = await this.subscribe(t, codes, SUB_BASIC);
    const out = new Map<string, any>();
    if (!live.length) return out;
    const res = await t.GetBasicQot({ c2s: { securityList: this.securities(live) } });
    for (const b of res?.s2c?.basicQotList ?? []) out.set(String(b.security?.code).toUpperCase(), b);
    return out;
  }

  /** The most recent candles for a code at an API interval ('5m', '1h', ...); null if that interval is not offered */
  async candles(code: string, interval: string, extended: boolean): Promise<{ bars: Bar[]; ms: number } | null> {
    const spec = KL[interval];
    if (!spec) return null;
    const t = await this.ensure();
    const ok = await this.subscribe(t, [code], spec.subType, extended);
    if (!ok.length) return null;
    const res = await t.GetKL({ c2s: { rehabType: 1, klType: spec.klType, security: this.securities([code])[0], reqNum: 1000 } });
    return { bars: klToBars(res?.s2c?.klList), ms: spec.ms };
  }

  close() {
    this.t?.close();
    this.t = null;
  }
}

type RouteFn = (path: string, query: Query) => Promise<ApiResult>;

/** Wraps the API router: quotes and the latest candles come from Moomoo; everything else is the original router */
export function withMoomoo(route: RouteFn, client: MoomooQuoteClient, cfg: MoomooConfig): RouteFn {
  const only = !!cfg.only;
  const tag = (body: any, source: string) => {
    if (body && typeof body === 'object') {
      if (Array.isArray(body.quotes)) body.quotes.forEach((q: any) => (q.source ??= source));
      else if (typeof body.price === 'number') body.source ??= source;
    }
    return body;
  };
  const unavailable = (why: string): ApiResult => ({ status: 503, body: { error: `Moomoo: ${why || 'no data'}` } });

  return async (path, query) => {
    const p = path.replace(/^\/+|\/+$/g, '');
    if (p === 'moomoo-status') {
      return {
        status: 200,
        body: { enabled: true, protocol: cfg.protocol ?? 'tcp', host: cfg.host, port: cfg.port, moomooOnly: only, connected: client.connected, subscriptions: client.subscriptionCount, lastError: client.lastError || null, note: client.note || null, readOnly: true },
      };
    }

    if (p === 'quote') {
      const code = toMoomooCode(query.symbol ?? '');
      if (code) {
        try {
          const b = (await client.quotes([code])).get(code);
          const body = b && toQuoteBody(query.symbol!.trim(), b, query.prepost === 'true');
          if (body && body.price !== null && body.price > 0) return { status: 200, body, cacheSeconds: 1 };
        } catch (e) {
          client.lastError = errText(e);
        }
        if (only) return unavailable(client.lastError || client.note || `no quote for ${query.symbol}`);
      } else if (only) {
        return unavailable(`${query.symbol} is not available from Moomoo here`);
      }
    }

    if (p === 'quotes') {
      const symbols = [...new Set((query.symbols ?? '').split(',').map((x) => x.trim()).filter(Boolean))];
      const eligible = symbols.filter((s) => toMoomooCode(s));
      const fromMoomoo = new Map<string, any>();
      let failure = '';
      if (eligible.length) {
        try {
          const got = await client.quotes(eligible.map((s) => toMoomooCode(s)!));
          for (const s of eligible) {
            const b = got.get(toMoomooCode(s)!);
            const regular = num(b?.curPrice);
            if (!b || regular === null) continue;
            const body = toQuoteBody(s, b, false);
            fromMoomoo.set(s, {
              symbol: s,
              name: b.name ?? '',
              price: regular,
              change: body.regularChange,
              changePercent: body.regularChangePercent,
              marketState: body.marketState,
              preMarketPrice: body.preMarketPrice,
              preMarketChangePercent: body.preMarketChangePercent,
              postMarketPrice: body.postMarketPrice,
              postMarketChangePercent: body.postMarketChangePercent,
              overnightPrice: body.overnightPrice,
              overnightChangePercent: body.overnightChangePercent,
              source: 'moomoo',
            });
          }
        } catch (e) {
          failure = errText(e);
          client.lastError = failure;
        }
      }
      if (only) {
        if (failure && !fromMoomoo.size) return unavailable(failure);
        const left = symbols.filter((s) => !fromMoomoo.has(s));
        return { status: 200, body: { quotes: symbols.map((s) => fromMoomoo.get(s)).filter(Boolean), missing: left }, cacheSeconds: 2 };
      }
      if (eligible.length) {
        const rest = symbols.filter((s) => !fromMoomoo.has(s));
        let yahoo: any = { quotes: [], missing: [] };
        if (rest.length) {
          const r = await route('quotes', { ...query, symbols: rest.join(',') });
          if (r.status !== 200 && !fromMoomoo.size) return r;
          if (r.status === 200) yahoo = tag(r.body, 'yahoo');
        }
        const byName = new Map<string, any>([...fromMoomoo, ...(yahoo.quotes ?? []).map((q: any): [string, any] => [q.symbol, q])]);
        return { status: 200, body: { quotes: symbols.map((s) => byName.get(s)).filter(Boolean), missing: yahoo.missing ?? [] }, cacheSeconds: 2 };
      }
    }

    if (p === 'chart') {
      const code = toMoomooCode(query.symbol ?? '');
      const base = await route(path, query);
      if (!code || !KL[query.interval ?? '5m']) return base;
      try {
        const live = await client.candles(code, query.interval ?? '5m', query.prepost === 'true');
        if (live && live.bars.length) {
          const yahooBars: Bar[] = base.status === 200 ? (base.body as any).bars : [];
          const merged = trimDays(mergeBars(yahooBars, live.bars, live.ms), query.range ?? '1d');
          if (merged.length) return { status: 200, body: { symbol: query.symbol, bars: merged, source: 'moomoo+yahoo' }, cacheSeconds: 1 };
        }
      } catch (e) {
        client.lastError = errText(e);
      }
      return base;
    }

    const result = await route(path, query);
    if (result.status === 200 && (p === 'quote' || p === 'quotes')) tag(result.body, 'yahoo');
    return result;
  };
}
