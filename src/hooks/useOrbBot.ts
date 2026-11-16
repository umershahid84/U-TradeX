import { useCallback, useEffect, useRef, useState } from 'react';
import { ChartData, Order, Position } from '../types';
import { RealMarketDataService } from '../services/realMarketData';
import { DEFAULT_ORB, OrbParams, orbSignal } from '../utils/orb';
import { etClock } from '../utils/lateDay';

export interface OrbBotConfig {
  /** Watch the symbol for today's breakout and alert */
  watch: boolean;
  /** Also place the paper trade when the signal appears (paper account only) */
  auto: boolean;
  symbol: string;
  orMinutes: number;
  targetR: number;
  riskPct: number;
  longs: boolean;
  shorts: boolean;
}

export const DEFAULT_BOT: OrbBotConfig = {
  watch: false,
  auto: false,
  symbol: 'SPY',
  orMinutes: DEFAULT_ORB.orMinutes,
  targetR: DEFAULT_ORB.targetR,
  riskPct: DEFAULT_ORB.riskPct,
  longs: true,
  shorts: true,
};

const KEY = 'orbBot';
const FIRED = 'orbBotFired';
const POLL_MS = 30_000;
// a breakout older than this is reported but never traded: the entry price is gone
const FRESH_MS = 15 * 60_000;

const load = (): OrbBotConfig => {
  try {
    return { ...DEFAULT_BOT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT_BOT;
  }
};

interface Deps {
  equity: number;
  cash: number;
  positions: Position[];
  pushToast: (title: string, body?: string, symbol?: string) => void;
  place: (order: Omit<Order, 'id' | 'status' | 'timestamp'>, takeProfit?: number, stopLoss?: number) => void;
}

/**
 * Rule-based paper bot (opening-range breakout). While "watch" is on it checks the symbol every 30 seconds during the
 * regular session, alerts on the day's first breakout and, if "auto" is on, places the paper trade with its stop and
 * target. It only ever uses the paper account, trades each symbol at most once a day and ignores stale signals.
 */
export const useOrbBot = ({ equity, cash, positions, pushToast, place }: Deps) => {
  const [config, setConfig] = useState<OrbBotConfig>(load);
  const [status, setStatus] = useState('');
  const deps = useRef({ equity, cash, positions, pushToast, place });
  deps.current = { equity, cash, positions, pushToast, place };

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch {
      /* storage unavailable */
    }
  }, [config]);

  const check = useCallback(async (c: OrbBotConfig) => {
    const et = etClock(Date.now());
    const open = et.weekday >= 1 && et.weekday <= 5 && et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60;
    if (!open) {
      setStatus('Waiting for the regular session (9:30 am to 4:00 pm ET).');
      return;
    }
    let bars: ChartData[];
    try {
      bars = await RealMarketDataService.getInstance().fetchChartData(c.symbol, '5m', '1d', false);
    } catch (e) {
      setStatus(`Could not read ${c.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const params: Partial<OrbParams> = { orMinutes: c.orMinutes, targetR: c.targetR, riskPct: c.riskPct, longs: c.longs, shorts: c.shorts };
    const sig = orbSignal(bars, params);
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (!sig) {
      setStatus(`Watching ${c.symbol} · no breakout of the opening range yet · checked ${now}`);
      return;
    }
    const id = `${sig.date}|${c.symbol}`;
    let fired: string[] = [];
    try {
      fired = JSON.parse(localStorage.getItem(FIRED) ?? '[]');
    } catch {
      /* none */
    }
    if (fired.includes(id)) {
      setStatus(`${c.symbol}: today's ${sig.side} signal was already handled.`);
      return;
    }
    const last = bars[bars.length - 1].close;
    const long = sig.side === 'long';
    // sig.time is when the breakout bar opened; it closed 5 minutes later
    const fresh = Date.now() - (sig.time + 5 * 60_000) <= FRESH_MS;
    const beyond = long ? last <= sig.stop || last >= sig.target : last >= sig.stop || last <= sig.target;
    const mark = () => {
      try {
        localStorage.setItem(FIRED, JSON.stringify([...fired.slice(-60), id]));
      } catch {
        /* storage unavailable */
      }
    };
    const text = `${sig.side.toUpperCase()} ${c.symbol}: broke the ${c.orMinutes}-min range (${sig.orLow.toFixed(2)}-${sig.orHigh.toFixed(2)}). Entry about ${last.toFixed(2)}, stop ${sig.stop.toFixed(2)}, target ${sig.target.toFixed(2)}.`;
    if (!fresh || beyond) {
      mark();
      setStatus(`Missed: ${text} The breakout is too old or price has moved past the levels, so nothing was traded.`);
      deps.current.pushToast(`ORB signal missed on ${c.symbol}`, 'Breakout too old to trade', c.symbol);
      return;
    }
    mark();
    const d = deps.current;
    if (c.auto) {
      if (d.positions.some((p) => p.symbol === c.symbol)) {
        setStatus(`Signal on ${c.symbol} but you already hold it, so the bot did not trade. ${text}`);
        d.pushToast(`ORB signal on ${c.symbol}`, 'Already holding it: no paper trade placed', c.symbol);
        return;
      }
      const risk = Math.abs(last - sig.stop);
      const qty = Math.floor(Math.min((d.equity * c.riskPct) / 100 / risk, d.cash / last));
      if (risk > 0 && qty >= 1) {
        d.place({ symbol: c.symbol, type: 'market', side: long ? 'buy' : 'sell', quantity: qty, price: last }, sig.target, sig.stop);
        setStatus(`Paper trade placed: ${long ? 'bought' : 'sold short'} ${qty} ${c.symbol}. ${text}`);
        d.pushToast(`🤖 Bot ${long ? 'bought' : 'shorted'} ${qty} ${c.symbol}`, `Stop ${sig.stop.toFixed(2)} · target ${sig.target.toFixed(2)} (paper)`, c.symbol);
        return;
      }
      setStatus(`Signal on ${c.symbol} but the size rounds to zero shares. ${text}`);
      return;
    }
    setStatus(`Signal: ${text}`);
    d.pushToast(`ORB ${sig.side} signal on ${c.symbol}`, `Entry ~${last.toFixed(2)} · stop ${sig.stop.toFixed(2)} · target ${sig.target.toFixed(2)}`, c.symbol);
  }, []);

  useEffect(() => {
    if (!config.watch) {
      setStatus('');
      return;
    }
    void check(config);
    const id = setInterval(() => void check(config), POLL_MS);
    return () => clearInterval(id);
  }, [config, check]);

  return { config, setConfig, status };
};
