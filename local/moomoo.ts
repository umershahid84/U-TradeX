// Local-only live market data from your own Moomoo account, through the OpenD gateway on this computer.
//
// READ-ONLY BY DESIGN: this code never builds a trade request, and the connection refuses to send anything
// except the quote commands in transport.ts (ALLOWED_CMDS), so even a bug cannot place an order. Orders in
// this app are paper orders; nothing here can touch real money.
//
// Used only by the Vite dev server (vite.config.ts). It is not part of the Vercel build.
import { sessionAt, Session } from '../src/utils/marketSessions';
import type { ApiResult, ScanRow } from '../api/_lib/market';
import { SCAN_UNIVERSE } from '../api/_lib/universe';
import { QuoteTransport, TcpTransport, WsTransport, errText, ALLOWED_CMDS, PUSH } from './transport';

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
const SUB_ORDERBOOK = 2; // Qot_Common.SubType_OrderBook
const MAX_SUBSCRIPTIONS = 60;
// the Air Gap scanner may hold this many candle subscriptions at once; the rest of its symbols use Yahoo
const SCAN_SLOTS = 25;
// OpenD only lets a subscription be cancelled a minute after it was made
const MIN_SUB_AGE_MS = 65_000;
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
    const t = this.makeTransport ? this.makeTransport(this.cfg) : this.cfg.protocol === 'ws' ? new WsTransport(this.cfg) : new TcpTransport(this.cfg);
    t.onPush = (cmd, msg) => this.handlePush(cmd, msg);
    return t;
  }

  // ---- live pushes: OpenD sends a quote / order book whenever it changes, after we subscribe ----
  private quoteListeners = new Set<(code: string, qot: any) => void>();
  private bookListeners = new Set<(code: string, book: { bid: number; ask: number }) => void>();

  /** Called for every pushed basic quote (code, BasicQot). Returns the function that stops listening. */
  onQuote(cb: (code: string, qot: any) => void): () => void {
    this.quoteListeners.add(cb);
    return () => this.quoteListeners.delete(cb);
  }
  /** Called for every pushed order book with its best bid and ask */
  onBook(cb: (code: string, book: { bid: number; ask: number }) => void): () => void {
    this.bookListeners.add(cb);
    return () => this.bookListeners.delete(cb);
  }

  private handlePush(cmd: number, msg: any) {
    if (cmd === PUSH.BASIC_QOT) {
      for (const b of msg?.s2c?.basicQotList ?? []) {
        const code = String(b.security?.code ?? '').toUpperCase();
        if (code) this.quoteListeners.forEach((cb) => cb(code, b));
      }
    } else if (cmd === PUSH.ORDER_BOOK) {
      const s2c = msg?.s2c;
      const code = String(s2c?.security?.code ?? '').toUpperCase();
      if (!code) return;
      const best = (list: any[]) => Number(list?.[0]?.price ?? 0) || 0;
      const book = { bid: best(s2c.orderBookBidList), ask: best(s2c.orderBookAskList) };
      this.bookListeners.forEach((cb) => cb(code, book));
    }
  }

  /** Start receiving pushes for codes (quotes, and the order book for option contracts); returns the codes now live */
  async watch(codes: string[], orderBook = false): Promise<string[]> {
    const t = await this.ensure();
    const live = await this.subscribe(t, codes, SUB_BASIC);
    if (orderBook && live.length) await this.subscribe(t, live, SUB_ORDERBOOK);
    return live;
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
        c2s: { securityList: this.securities(list), subTypeList: [subType], isSubOrUnSub: true, isRegOrUnRegPush: subType === SUB_BASIC || subType === SUB_ORDERBOOK, ...(extended ? { extendedTime: true } : {}) },
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
  private scanSubs: { code: string; subType: number; extended: boolean; at: number }[] = [];

  /** Cancel a subscription (read-only housekeeping: it frees one of the account's quote slots) */
  private async unsubscribe(t: QuoteTransport, code: string, subType: number, extended: boolean) {
    try {
      await t.Sub({ c2s: { securityList: this.securities([code]), subTypeList: [subType], isSubOrUnSub: false, isRegOrUnRegPush: false, ...(extended ? { extendedTime: true } : {}) } });
    } finally {
      this.subscribed.delete(`${code}|${subType}|${extended ? 1 : 0}`);
    }
  }

  /**
   * The most recent candles. With `scan` the request comes from the Air Gap scanner, which may only hold SCAN_SLOTS
   * subscriptions: when they are all taken the oldest is cancelled for the new symbol, and if none is old enough yet the
   * answer is null (the caller uses Yahoo for that symbol).
   */
  async candles(code: string, interval: string, extended: boolean, opts: { scan?: boolean } = {}): Promise<{ bars: Bar[]; ms: number } | null> {
    const spec = KL[interval];
    if (!spec) return null;
    const t = await this.ensure();
    if (opts.scan) {
      const known = this.scanSubs.find((s) => s.code === code && s.subType === spec.subType && s.extended === extended);
      if (!known) {
        if (this.scanSubs.length >= SCAN_SLOTS) {
          const oldest = this.scanSubs[0];
          if (Date.now() - oldest.at < MIN_SUB_AGE_MS) return null;
          this.scanSubs.shift();
          try {
            await this.unsubscribe(t, oldest.code, oldest.subType, oldest.extended);
          } catch {
            /* the slot is reused anyway */
          }
        }
      }
    }
    const ok = await this.subscribe(t, [code], spec.subType, extended);
    if (!ok.length) return null;
    if (opts.scan && !this.scanSubs.some((s) => s.code === code && s.subType === spec.subType && s.extended === extended)) {
      this.scanSubs.push({ code, subType: spec.subType, extended, at: Date.now() });
    }
    const res = await t.GetKL({ c2s: { rehabType: 1, klType: spec.klType, security: this.securities([code])[0], reqNum: 1000 } });
    return { bars: klToBars(res?.s2c?.klList), ms: spec.ms };
  }

  // ---- options ----
  private chainStatic = new Map<string, { at: number; rows: OptionRow[] }>();
  private chainLive = new Map<string, { at: number; value: Promise<any> }>();

  // ---- index and sector lists ----
  private universeCache = new Map<string, { at: number; value: { symbols: string[]; plate: string } }>();

  /** The stocks of one plate or index by its code (e.g. ".SPX"), as plain tickers */
  private async plateTickers(t: QuoteTransport, code: string): Promise<string[]> {
    const res = await t.GetPlateSecurity({ c2s: { plate: { market: US_MARKET, code } } });
    const out: string[] = [];
    for (const it of res?.s2c?.staticInfoList ?? []) {
      const c = String(it?.basic?.security?.code ?? '').toUpperCase();
      // plain tickers only (no options, warrants or index codes); BRK.B becomes BRK-B like the rest of the app
      if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(c)) out.push(c.replace('.', '-'));
    }
    return [...new Set(out)];
  }

  /**
   * Constituents of an index as Moomoo classifies it ("sp500", "ndx", "russell3000"): first by the index's own code, then by
   * looking for a plate with a matching name among the US plates. Cached for 12 hours.
   */
  async universe(name: string): Promise<{ symbols: string[]; plate: string }> {
    const hit = this.universeCache.get(name);
    if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.value;
    const spec: Record<string, { codes: string[]; names: RegExp; min: number }> = {
      sp500: { codes: ['.SPX'], names: /s&p\s*500|sp\s*500|标普\s*500/i, min: 400 },
      ndx: { codes: ['.NDX'], names: /nasdaq[\s-]*100|纳斯达克\s*100|纳指\s*100/i, min: 80 },
      russell3000: { codes: ['.RUA'], names: /russell\s*3000|罗素\s*3000/i, min: 1500 },
    };
    const s = spec[name];
    if (!s) throw new Error(`Unknown list ${name}`);
    const t = await this.ensure();
    const tried: string[] = [];
    for (const code of s.codes) {
      try {
        const list = await this.plateTickers(t, code);
        tried.push(`${code}: ${list.length}`);
        if (list.length >= s.min) return this.remember(name, list, code);
      } catch (e) {
        tried.push(`${code}: ${errText(e)}`);
      }
    }
    // not an index OpenD serves directly: look for a plate by name
    const plates: { code: string; name: string }[] = [];
    for (const type of [4, 3, 0]) {
      try {
        const res = await t.GetPlateSet({ c2s: { market: US_MARKET, plateSetType: type } });
        for (const p of res?.s2c?.plateInfoList ?? []) if (!plates.some((x) => x.code === String(p.plate?.code))) plates.push({ code: String(p.plate?.code), name: String(p.name) });
      } catch (e) {
        tried.push(`plates(${type}): ${errText(e)}`);
      }
    }
    for (const p of plates.filter((x) => s.names.test(x.name))) {
      try {
        const list = await this.plateTickers(t, p.code);
        tried.push(`${p.name}: ${list.length}`);
        if (list.length >= s.min) return this.remember(name, list, `${p.name} (${p.code})`);
      } catch (e) {
        tried.push(`${p.name}: ${errText(e)}`);
      }
    }
    const near = plates.filter((x) => /index|constituent|500|100|russell|nasdaq|成分/i.test(x.name)).slice(0, 12).map((x) => x.name);
    throw new Error(`Moomoo has no list for ${name} (${tried.join('; ') || 'nothing found'})${near.length ? `. Similar plates: ${near.join(', ')}` : ''}`);
  }

  private remember(name: string, symbols: string[], plate: string) {
    const value = { symbols, plate };
    this.universeCache.set(name, { at: Date.now(), value });
    return value;
  }

  /** Expiry dates (YYYY-MM-DD) with listed options for an underlying */
  async optionExpirations(code: string): Promise<string[]> {
    const t = await this.ensure();
    const res = await t.GetOptionExpirationDate({ c2s: { owner: { market: US_MARKET, code } } });
    return (res?.s2c?.dateList ?? [])
      .filter((d: any) => d.optionExpiryDateDistance == null || d.optionExpiryDateDistance >= 0)
      .map((d: any) => String(d.strikeTime))
      .sort();
  }

  /** Every strike of one expiry with its call and put contract codes (changes rarely, so cached for 10 minutes) */
  private async chainCodes(t: QuoteTransport, code: string, expiry: string): Promise<OptionRow[]> {
    const key = `${code}|${expiry}`;
    const hit = this.chainStatic.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows;
    const res = await t.GetOptionChain({ c2s: { owner: { market: US_MARKET, code }, beginTime: expiry, endTime: expiry } });
    const rows: OptionRow[] = [];
    for (const chain of res?.s2c?.optionChain ?? []) {
      for (const it of chain.option ?? []) {
        const strike = it.call?.optionExData?.strikePrice ?? it.put?.optionExData?.strikePrice;
        if (typeof strike === 'number') rows.push({ strike, call: it.call?.basic?.security?.code, put: it.put?.basic?.security?.code });
      }
    }
    this.chainStatic.set(key, { at: Date.now(), rows });
    return rows;
  }

  /** Snapshots (last, bid, ask, volume, open interest, IV) for option contract codes, in batches */
  private async snapshots(t: QuoteTransport, codes: string[]): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    for (let i = 0; i < codes.length; i += 200) {
      const res = await t.GetSecuritySnapshot({ c2s: { securityList: this.securities(codes.slice(i, i + 200)) } });
      for (const sn of res?.s2c?.snapshotList ?? []) out.set(String(sn.basic?.security?.code), sn);
    }
    return out;
  }

  private badCodes = new Set<string>();
  private scanCache: { at: number; key: string; rows: Map<string, any> } | null = null;

  /**
   * Snapshots for many stock codes. A code OpenD does not know fails the whole batch, so a failing batch is split
   * in halves until the bad code is found; bad codes are remembered and skipped next time. Capped per scan (40 requests) so a
   * list full of dead tickers cannot exhaust OpenD's request limit.
   */
  async stockSnapshots(codes: string[]): Promise<Map<string, any>> {
    const key = codes.join(',');
    if (this.scanCache && this.scanCache.key === key && Date.now() - this.scanCache.at < 10_000) return this.scanCache.rows;
    const t = await this.ensure();
    const out = new Map<string, any>();
    let calls = 0;
    const run = async (chunk: string[]): Promise<void> => {
      if (!chunk.length || calls >= 40) return;
      calls++;
      try {
        const res = await t.GetSecuritySnapshot({ c2s: { securityList: this.securities(chunk) } });
        for (const sn of res?.s2c?.snapshotList ?? []) out.set(String(sn.basic?.security?.code), sn);
      } catch (e) {
        if (chunk.length === 1) {
          this.badCodes.add(chunk[0]);
          this.note = `${chunk[0]}: ${errText(e)}`;
          return;
        }
        // if the error names the offending code, drop just that one; otherwise split the batch in half
        const named = chunk.find((c) => new RegExp(`(^|[^A-Z0-9.])${c.replace('.', '\\.')}([^A-Z0-9.]|$)`).test(errText(e)));
        if (named) {
          this.badCodes.add(named);
          this.note = `${named}: ${errText(e)}`;
          await run(chunk.filter((c) => c !== named));
          return;
        }
        const mid = Math.ceil(chunk.length / 2);
        await run(chunk.slice(0, mid));
        await run(chunk.slice(mid));
      }
    };
    const todo = codes.filter((c) => !this.badCodes.has(c));
    for (let i = 0; i < todo.length; i += 50) await run(todo.slice(i, i + 50));
    this.scanCache = { at: Date.now(), key, rows: out };
    return out;
  }

  /** One expiry's chain with live prices; strikes further than 40% from spot are left out */
  optionChain(code: string, expiry: string): Promise<{ calls: any[]; puts: any[] }> {
    const key = `${code}|${expiry}`;
    const hit = this.chainLive.get(key);
    if (hit && Date.now() - hit.at < 4000) return hit.value; // protect OpenD's request limits
    const value = (async () => {
      const t = await this.ensure();
      const [rows, spotQuote] = await Promise.all([this.chainCodes(t, code, expiry), this.quotes([code])]);
      const spot = num(spotQuote.get(code)?.curPrice) ?? 0;
      const near = rows.filter((r) => !spot || (r.strike >= spot * 0.6 && r.strike <= spot * 1.4));
      const codes = near.flatMap((r) => [r.call, r.put]).filter((c): c is string => !!c);
      const snaps = await this.snapshots(t, codes);
      const make = (c: string | undefined, strike: number, call: boolean) => {
        const sn = c ? snaps.get(c) : undefined;
        if (!sn) return null;
        const b = sn.basic, x = sn.optionExData;
        return {
          strike,
          lastPrice: b.curPrice ?? 0,
          bid: b.bidPrice ?? 0,
          ask: b.askPrice ?? 0,
          volume: Number(String(b.volume ?? 0)),
          openInterest: x?.openInterest ?? 0,
          impliedVolatility: (x?.impliedVolatility ?? 0) / 100, // Moomoo reports percent
          inTheMoney: spot ? (call ? spot > strike : spot < strike) : false,
        };
      };
      return {
        calls: near.map((r) => make(r.call, r.strike, true)).filter(Boolean) as any[],
        puts: near.map((r) => make(r.put, r.strike, false)).filter(Boolean) as any[],
      };
    })();
    this.chainLive.set(key, { at: Date.now(), value });
    value.catch(() => this.chainLive.delete(key));
    return value;
  }

  /** Live quotes for specific contracts: "SPY|2026-11-27|770|call" */
  /** Moomoo contract codes for keys like "SPY|2026-11-27|760|call" */
  async resolveContracts(contracts: string[]): Promise<{ key: string; contract: string }[]> {
    const t = await this.ensure();
    const want = contracts.map((c) => {
      const [symbol, expiry, strike, type] = c.split('|');
      return { key: c, code: toMoomooCode(symbol), expiry, strike: Number(strike), type: type === 'put' ? 'put' : 'call' };
    });
    const codes: { key: string; contract: string }[] = [];
    for (const w of want) {
      if (!w.code || !w.expiry || !Number.isFinite(w.strike)) continue;
      const row = (await this.chainCodes(t, w.code, w.expiry)).find((r) => Math.abs(r.strike - w.strike) < 0.0005);
      const contract = w.type === 'put' ? row?.put : row?.call;
      if (contract) codes.push({ key: w.key, contract });
    }
    return codes;
  }

  async contractQuotes(contracts: string[]): Promise<any[]> {
    const t = await this.ensure();
    const codes = await this.resolveContracts(contracts);
    const snaps = await this.snapshots(t, codes.map((c) => c.contract));
    return codes.flatMap((c) => {
      const sn = snaps.get(c.contract);
      if (!sn) return [];
      const bid = sn.basic.bidPrice ?? 0, ask = sn.basic.askPrice ?? 0, last = sn.basic.curPrice ?? 0;
      return [{ key: c.key, bid, ask, last, mark: bid > 0 && ask > 0 ? (bid + ask) / 2 : last, iv: (sn.optionExData?.impliedVolatility ?? 0) / 100 }];
    });
  }

  close() {
    this.t?.close();
    this.t = null;
  }
}

interface OptionRow { strike: number; call?: string; put?: string }

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

    if (p === 'universe') {
      try {
        const u = await client.universe(String(query.name ?? ''));
        return { status: 200, body: { name: query.name, symbols: u.symbols, plate: u.plate, source: 'moomoo' }, cacheSeconds: 600 };
      } catch (e) {
        return { status: 404, body: { error: errText(e) } };
      }
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

    if (p === 'options/expirations' || p === 'options') {
      const code = toMoomooCode(query.symbol ?? '');
      if (code && !code.startsWith('.')) {
        try {
          const dates = await client.optionExpirations(code);
          if (p === 'options/expirations') return { status: 200, body: { expirations: dates, source: 'moomoo' }, cacheSeconds: 60 };
          const expiry = query.date && dates.includes(query.date.slice(0, 10)) ? query.date.slice(0, 10) : dates[0];
          if (expiry) {
            const chain = await client.optionChain(code, expiry);
            return { status: 200, body: { chains: [{ expirationDate: expiry, calls: chain.calls, puts: chain.puts }], source: 'moomoo' }, cacheSeconds: 4 };
          }
        } catch (e) {
          client.lastError = errText(e);
        }
        if (only) return unavailable(client.lastError || client.note || `no options for ${query.symbol}`);
      } else if (only) {
        return unavailable(`options for ${query.symbol} are not available from Moomoo here`);
      }
    }

    if (p === 'scan') {
      const extra = (query.symbols ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      const symbols = [...new Set([...SCAN_UNIVERSE, ...extra])];
      const byCode = new Map<string, string>();
      for (const sym of symbols) {
        const c = toMoomooCode(sym);
        if (c && !c.startsWith('.')) byCode.set(c, sym);
      }
      try {
        const snaps = await client.stockSnapshots([...byCode.keys()]);
        const session = sessionAt(Date.now());
        const rows: ScanRow[] = [];
        for (const [code, sn] of snaps) {
          const b = sn.basic;
          const regular = num(b.curPrice);
          if (!regular) continue;
          const prev = num(b.lastClosePrice);
          const open = num(b.openPrice);
          const price = pickPrice({ curPrice: regular, preMarket: b.preMarket, afterMarket: b.afterMarket, overnight: b.overnight }, session) ?? regular;
          const gapPct = session === 'regular' ? (open && prev ? (open / prev - 1) * 100 : null) : price !== regular ? (price / regular - 1) * 100 : null;
          rows.push({
            symbol: byCode.get(code) ?? code,
            name: b.name ?? '',
            price,
            prevClose: prev,
            gapPct,
            dayPct: prev ? (regular / prev - 1) * 100 : null,
            volumeRatio: num(b.volumeRatio),
            volume: b.volume != null ? Number(String(b.volume)) : null,
            session: session.toUpperCase(),
            source: 'moomoo',
          });
        }
        if (rows.length) return { status: 200, body: { rows, universe: byCode.size, source: 'moomoo' }, cacheSeconds: 10 };
      } catch (e) {
        client.lastError = errText(e);
      }
      if (only) return unavailable(client.lastError || client.note || 'no scan data');
    }

    if (p === 'optionquotes') {
      const contracts = (query.contracts ?? '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 40);
      if (!contracts.length) return { status: 200, body: { quotes: [] } };
      try {
        return { status: 200, body: { quotes: await client.contractQuotes(contracts), source: 'moomoo' }, cacheSeconds: 2 };
      } catch (e) {
        client.lastError = errText(e);
        return unavailable(client.lastError);
      }
    }

    if (p === 'chart') {
      const code = toMoomooCode(query.symbol ?? '');
      const base = await route(path, query);
      // a full scan asks for Yahoo only: hundreds of symbols must not use up Moomoo's limited subscriptions
      if (query.yahoo === '1') return base;
      if (!code || !KL[query.interval ?? '5m']) return base;
      try {
        const live = await client.candles(code, query.interval ?? '5m', query.prepost === 'true', { scan: query.scan === '1' });
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
