// Local-only live quotes from your own Moomoo account, through the OpenD gateway running on this computer.
//
// READ-ONLY BY DESIGN: this file never builds a trade request, and the connection it opens refuses to send
// anything except the three quote commands in ALLOWED_CMDS (so even a bug cannot place an order). Orders in
// this app are paper orders; nothing here can touch real money.
//
// Used only by the Vite dev server (vite.config.ts). It is not part of the Vercel build.
import { sessionAt, Session } from '../src/utils/marketSessions';
import type { ApiResult } from '../api/_lib/market';

export interface MoomooConfig {
  host: string;
  port: number;
  /** The WebSocket key set in OpenD, if any */
  key?: string;
  ssl?: boolean;
}

// OpenD websocket init handshake (1), subscribe (3001), basic quote (3004). Everything else, including every
// trade command (2xxx), is rejected before it is sent.
export const ALLOWED_CMDS = new Set([1, 3001, 3004]);

const US_MARKET = 11; // Qot_Common.QotMarket_US_Security
const SUB_BASIC = 1; // Qot_Common.SubType_Basic
const MAX_SUBSCRIPTIONS = 60;
const CONNECT_TIMEOUT_MS = 8000;
const RETRY_AFTER_FAILURE_MS = 15000;

type Query = Record<string, string | undefined>;

/** App symbols the US feed can serve: plain tickers (BRK-B becomes BRK.B). Indices and futures use Yahoo. */
export const toMoomooCode = (symbol: string): string | null => {
  const s = symbol.trim().toUpperCase();
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

const errText = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const o = e as { retMsg?: string; errmsg?: string } | null;
  return o?.retMsg || o?.errmsg || JSON.stringify(e);
};

/** Connection to OpenD that can only ask for quotes */
export class MoomooQuoteClient {
  private ws: any = null;
  private starting: Promise<void> | null = null;
  private subscribed = new Set<string>();
  private subscribedConn = -1;
  private downUntil = 0;
  /** Why the connection failed (cleared on success) */
  lastError = '';
  /** Last symbol OpenD would not serve (bad code, or no quote rights) */
  note = '';

  constructor(private cfg: MoomooConfig, private loadSdk: () => Promise<any> = () => import('moomoo-api')) {}

  get connected(): boolean {
    return !!this.ws?.websock?.isReadyConnect?.();
  }
  get subscriptionCount(): number {
    return this.subscribed.size;
  }

  private async open(): Promise<void> {
    const sdk = await this.loadSdk();
    const Ws = sdk.default ?? sdk;
    const ws = new Ws();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`OpenD did not answer on ${this.cfg.host}:${this.cfg.port}`)), CONNECT_TIMEOUT_MS);
      ws.onlogin = (ok: boolean, msg: unknown) => {
        clearTimeout(timer);
        if (ok) resolve();
        else reject(new Error(`OpenD refused the connection (${errText(msg)}); check the WebSocket key`));
      };
      ws.start(this.cfg.host, this.cfg.port, !!this.cfg.ssl, this.cfg.key || '');
      // read-only guard on the lowest layer: only quote commands may leave this process
      const base = ws.websock;
      // fail fast when nothing is listening instead of waiting for the timeout
      base.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Cannot reach OpenD at ${this.cfg.host}:${this.cfg.port}. Is it running, with its WebSocket port enabled?`));
      };
      const send = base.sendBuff.bind(base);
      base.sendBuff = (cmd: number, buff: unknown, timeout?: number) =>
        ALLOWED_CMDS.has(cmd) ? send(cmd, buff, timeout) : Promise.reject(new Error(`blocked command ${cmd}: this connection is read-only`));
    });
    this.ws = ws;
  }

  private async ensure(): Promise<void> {
    if (this.connected) return;
    if (Date.now() < this.downUntil) throw new Error(this.lastError || 'OpenD unavailable');
    this.starting ??= this.open()
      .catch((e) => {
        this.lastError = errText(e);
        this.downUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
        try {
          this.ws?.websock?.close();
        } catch {
          /* already closed */
        }
        this.ws = null;
        throw e;
      })
      .finally(() => {
        this.starting = null;
      });
    await this.starting;
    this.lastError = '';
  }

  private securities(codes: string[]) {
    return codes.map((code) => ({ market: US_MARKET, code }));
  }

  private async subscribe(codes: string[]): Promise<string[]> {
    const conn = this.ws.websock.connID;
    if (conn !== this.subscribedConn) {
      this.subscribed.clear(); // subscriptions belong to a connection
      this.subscribedConn = conn;
    }
    const need = codes.filter((c) => !this.subscribed.has(c));
    const room = Math.max(0, MAX_SUBSCRIPTIONS - this.subscribed.size);
    const take = need.slice(0, room);
    const ok: string[] = [];
    const sub = (list: string[]) =>
      this.ws.Sub({ c2s: { securityList: this.securities(list), subTypeList: [SUB_BASIC], isSubOrUnSub: true, isRegOrUnRegPush: false } });
    if (take.length) {
      try {
        await sub(take);
        take.forEach((c) => this.subscribed.add(c));
      } catch (e) {
        // one bad code fails the batch: find the good ones
        for (const c of take) {
          try {
            await sub([c]);
            this.subscribed.add(c);
          } catch (single) {
            this.note = `${c}: ${errText(single)}`;
          }
        }
      }
    }
    codes.forEach((c) => this.subscribed.has(c) && ok.push(c));
    return ok;
  }

  /** Basic quotes by moomoo code; codes OpenD can't serve are left out */
  async quotes(codes: string[]): Promise<Map<string, any>> {
    await this.ensure();
    const live = await this.subscribe(codes);
    const out = new Map<string, any>();
    if (!live.length) return out;
    const res = await this.ws.GetBasicQot({ c2s: { securityList: this.securities(live) } });
    for (const b of res?.s2c?.basicQotList ?? []) out.set(String(b.security?.code).toUpperCase(), b);
    return out;
  }

  close() {
    try {
      this.ws?.websock?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

type RouteFn = (path: string, query: Query) => Promise<ApiResult>;

/** Wraps the API router: quotes come from Moomoo when it can serve them, otherwise from the original router (Yahoo) */
export function withMoomoo(route: RouteFn, client: MoomooQuoteClient, cfg: MoomooConfig): RouteFn {
  const tag = (body: any, source: string) => {
    if (body && typeof body === 'object') {
      if (Array.isArray(body.quotes)) body.quotes.forEach((q: any) => (q.source ??= source));
      else if (typeof body.price === 'number') body.source ??= source;
    }
    return body;
  };

  return async (path, query) => {
    const p = path.replace(/^\/+|\/+$/g, '');
    if (p === 'moomoo-status') {
      return {
        status: 200,
        body: { enabled: true, host: cfg.host, port: cfg.port, connected: client.connected, subscriptions: client.subscriptionCount, lastError: client.lastError || null, note: client.note || null, readOnly: true },
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
      }
    }

    if (p === 'quotes') {
      const symbols = [...new Set((query.symbols ?? '').split(',').map((x) => x.trim()).filter(Boolean))];
      const eligible = symbols.filter((s) => toMoomooCode(s));
      if (eligible.length) {
        const fromMoomoo = new Map<string, any>();
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
          client.lastError = errText(e);
        }
        const rest = symbols.filter((s) => !fromMoomoo.has(s));
        let yahoo: any = { quotes: [], missing: [] };
        if (rest.length) {
          const r = await route('quotes', { ...query, symbols: rest.join(',') });
          if (r.status !== 200 && !fromMoomoo.size) return r;
          if (r.status === 200) yahoo = tag(r.body, 'yahoo');
        }
        const byName = new Map<string, any>([...fromMoomoo, ...(yahoo.quotes ?? []).map((q: any): [string, any] => [q.symbol, q])]);
        return {
          status: 200,
          body: { quotes: symbols.map((s) => byName.get(s)).filter(Boolean), missing: yahoo.missing ?? [] },
          cacheSeconds: 2,
        };
      }
    }

    const result = await route(path, query);
    if (result.status === 200 && (p === 'quote' || p === 'quotes')) tag(result.body, 'yahoo');
    return result;
  };
}
