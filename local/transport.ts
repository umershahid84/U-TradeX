// How this app talks to OpenD. Two interchangeable transports behind one small interface:
//  - TcpTransport: OpenD's native socket (the "API port", 11111 by default). No extra OpenD setting needed.
//  - WsTransport: the WebSocket port (33333 by default), through Moomoo's own JavaScript SDK.
// Both are READ-ONLY: only the quote commands in ALLOWED_CMDS can ever be sent; any other command (every
// trade command included) is rejected before it reaches the socket.
import net from 'node:net';
import crypto from 'node:crypto';

export interface TransportConfig {
  host: string;
  port: number;
  /** WebSocket key set in OpenD (WebSocket transport only) */
  key?: string;
  ssl?: boolean;
}

export const CMD = {
  WS_INIT: 1,
  INIT_CONNECT: 1001,
  KEEP_ALIVE: 1004,
  SUB: 3001,
  GET_BASIC_QOT: 3004,
  GET_KL: 3006,
  GET_SNAPSHOT: 3203,
  GET_OPTION_CHAIN: 3209,
  GET_OPTION_EXPIRATION: 3224,
} as const;

// connect/keep-alive plus market-data requests only (subscribe, quotes, candles, snapshots, option expirations and chains)
export const ALLOWED_CMDS: ReadonlySet<number> = new Set(Object.values(CMD));

export interface QuoteTransport {
  start(): Promise<void>;
  readonly connected: boolean;
  /** Changes when the underlying connection is replaced (subscriptions do not survive that) */
  readonly connID: number;
  Sub(req: unknown): Promise<any>;
  GetBasicQot(req: unknown): Promise<any>;
  GetKL(req: unknown): Promise<any>;
  GetSecuritySnapshot(req: unknown): Promise<any>;
  GetOptionChain(req: unknown): Promise<any>;
  GetOptionExpirationDate(req: unknown): Promise<any>;
  close(): void;
}

export const errText = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const o = e as { retMsg?: string; errmsg?: string } | null;
  return o?.retMsg || o?.errmsg || JSON.stringify(e);
};

const CONNECT_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 6000;
const HEADER_LEN = 44;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? 0)));

/** Native OpenD protocol: 44-byte little-endian header ("FT", proto id, format, version, serial, body length, SHA-1), then a protobuf body */
export class TcpTransport implements QuoteTransport {
  private socket: net.Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }>();
  private serial = 0;
  private keepTimer: NodeJS.Timeout | null = null;
  private ready = false;
  private root: any = null;
  connID = 0;

  constructor(private cfg: TransportConfig, private loadProto: () => Promise<any> = async () => (await import('moomoo-api/proto.js')).default) {}

  get connected(): boolean {
    return this.ready && !!this.socket && !this.socket.destroyed;
  }

  async start(): Promise<void> {
    this.root = await this.loadProto();
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.cfg.host, port: this.cfg.port });
      this.socket = socket;
      socket.setNoDelay(true);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`OpenD did not answer on ${this.cfg.host}:${this.cfg.port}`));
      }, CONNECT_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(new Error(`Cannot reach OpenD at ${this.cfg.host}:${this.cfg.port} (${e.code ?? e.message}). Is it running and logged in?`));
      });
      socket.on('data', (d: Buffer) => this.onData(d));
      socket.on('close', () => this.onClose());
    });
    this.socket!.on('error', () => undefined); // later errors surface through 'close'

    let init: any;
    try {
      init = await this.rpc(CMD.INIT_CONNECT, 'InitConnect', {
        c2s: { clientVer: 1, clientID: 'u-tradex-local', recvNotify: false, programmingLanguage: 'JavaScript' },
      });
    } catch (e) {
      this.close();
      throw new Error(`OpenD handshake failed (${errText(e)}). If you enabled RSA encryption in OpenD, turn it off for this app.`);
    }
    this.connID = num(init?.s2c?.connID);
    const every = Math.max(5, Math.floor(num(init?.s2c?.keepAliveInterval || 10) * 0.8));
    this.keepTimer = setInterval(() => {
      this.rpc(CMD.KEEP_ALIVE, 'KeepAlive', { c2s: { time: Math.floor(Date.now() / 1000) } }).catch(() => undefined);
    }, every * 1000);
    this.keepTimer.unref?.();
    this.ready = true;
  }

  private frame(cmd: number, body: Uint8Array): Buffer {
    const out = Buffer.alloc(HEADER_LEN + body.length);
    out.write('FT', 0, 'latin1');
    out.writeUInt32LE(cmd, 2);
    out.writeUInt8(0, 6); // body format: protobuf
    out.writeUInt8(0, 7); // protocol version
    out.writeUInt32LE(++this.serial, 8);
    out.writeUInt32LE(body.length, 12);
    crypto.createHash('sha1').update(body).digest().copy(out, 16);
    Buffer.from(body).copy(out, HEADER_LEN);
    return out;
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= HEADER_LEN) {
      if (this.buf.toString('latin1', 0, 2) !== 'FT') {
        this.fail(new Error('Unexpected data from OpenD (is this the API port?)'));
        this.close();
        return;
      }
      const len = this.buf.readUInt32LE(12);
      if (this.buf.length < HEADER_LEN + len) return;
      const cmd = this.buf.readUInt32LE(2);
      const serial = this.buf.readUInt32LE(8);
      const body = this.buf.subarray(HEADER_LEN, HEADER_LEN + len);
      this.buf = this.buf.subarray(HEADER_LEN + len);
      const waiter = this.pending.get(serial);
      if (!waiter) continue; // a push we did not ask for
      this.pending.delete(serial);
      clearTimeout(waiter.timer);
      try {
        const name = this.nameOf(cmd);
        const res = this.root.lookup(`${name}.Response`).decode(body);
        if (res.retType === 0) waiter.resolve(res);
        else waiter.reject(res);
      } catch (e) {
        waiter.reject(e);
      }
    }
  }

  private nameOf(cmd: number): string {
    const names: Record<number, string> = {
      [CMD.INIT_CONNECT]: 'InitConnect',
      [CMD.KEEP_ALIVE]: 'KeepAlive',
      [CMD.SUB]: 'Qot_Sub',
      [CMD.GET_BASIC_QOT]: 'Qot_GetBasicQot',
      [CMD.GET_KL]: 'Qot_GetKL',
      [CMD.GET_SNAPSHOT]: 'Qot_GetSecuritySnapshot',
      [CMD.GET_OPTION_CHAIN]: 'Qot_GetOptionChain',
      [CMD.GET_OPTION_EXPIRATION]: 'Qot_GetOptionExpirationDate',
    };
    return names[cmd];
  }

  private fail(e: unknown) {
    for (const [, w] of this.pending) {
      clearTimeout(w.timer);
      w.reject(e);
    }
    this.pending.clear();
  }

  private onClose() {
    this.ready = false;
    if (this.keepTimer) clearInterval(this.keepTimer);
    this.keepTimer = null;
    this.fail(new Error('OpenD closed the connection'));
  }

  private rpc(cmd: number, name: string, req: unknown): Promise<any> {
    // read-only guard: nothing but the allow-listed quote commands may be written to the socket
    if (!ALLOWED_CMDS.has(cmd)) return Promise.reject(new Error(`blocked command ${cmd}: this connection is read-only`));
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('OpenD is not connected'));
    const T = this.root.lookup(`${name}.Request`);
    const body = T.encode(T.create(req)).finish();
    const packet = this.frame(cmd, body);
    const serial = this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new Error(`OpenD did not answer ${name}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(serial, { resolve, reject, timer });
      this.socket!.write(packet);
    });
  }

  Sub(req: unknown) {
    return this.rpc(CMD.SUB, 'Qot_Sub', req);
  }
  GetBasicQot(req: unknown) {
    return this.rpc(CMD.GET_BASIC_QOT, 'Qot_GetBasicQot', req);
  }
  GetKL(req: unknown) {
    return this.rpc(CMD.GET_KL, 'Qot_GetKL', req);
  }
  GetSecuritySnapshot(req: unknown) {
    return this.rpc(CMD.GET_SNAPSHOT, 'Qot_GetSecuritySnapshot', req);
  }
  GetOptionChain(req: unknown) {
    return this.rpc(CMD.GET_OPTION_CHAIN, 'Qot_GetOptionChain', req);
  }
  GetOptionExpirationDate(req: unknown) {
    return this.rpc(CMD.GET_OPTION_EXPIRATION, 'Qot_GetOptionExpirationDate', req);
  }

  close() {
    this.ready = false;
    if (this.keepTimer) clearInterval(this.keepTimer);
    this.keepTimer = null;
    this.socket?.destroy();
    this.fail(new Error('closed'));
  }
}

/** WebSocket transport through Moomoo's JavaScript SDK (OpenD's separate WebSocket port) */
export class WsTransport implements QuoteTransport {
  private ws: any = null;
  constructor(private cfg: TransportConfig, private loadSdk: () => Promise<any> = () => import('moomoo-api')) {}

  get connected(): boolean {
    return !!this.ws?.websock?.isReadyConnect?.();
  }
  get connID(): number {
    return num(this.ws?.websock?.connID);
  }

  async start(): Promise<void> {
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
      const base = ws.websock;
      base.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Cannot reach OpenD's WebSocket at ${this.cfg.host}:${this.cfg.port}. Enable the WebSocket port in OpenD, or use the default socket port with MOOMOO_PROTOCOL=tcp.`));
      };
      // read-only guard on the lowest layer of the SDK
      const send = base.sendBuff.bind(base);
      base.sendBuff = (cmd: number, buff: unknown, timeout?: number) =>
        ALLOWED_CMDS.has(cmd) ? send(cmd, buff, timeout) : Promise.reject(new Error(`blocked command ${cmd}: this connection is read-only`));
    }).catch((e) => {
      try {
        ws.websock?.close();
      } catch {
        /* closed */
      }
      throw e;
    });
    this.ws = ws;
  }

  Sub(req: unknown) {
    return this.ws.Sub(req);
  }
  GetBasicQot(req: unknown) {
    return this.ws.GetBasicQot(req);
  }
  GetKL(req: unknown) {
    return this.ws.GetKL(req);
  }
  GetSecuritySnapshot(req: unknown) {
    return this.ws.GetSecuritySnapshot(req);
  }
  GetOptionChain(req: unknown) {
    return this.ws.GetOptionChain(req);
  }
  GetOptionExpirationDate(req: unknown) {
    return this.ws.GetOptionExpirationDate(req);
  }
  close() {
    try {
      this.ws?.websock?.close();
    } catch {
      /* closed */
    }
    this.ws = null;
  }
}
