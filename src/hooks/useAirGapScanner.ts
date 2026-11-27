import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RealMarketDataService } from '../services/realMarketData';
import { AirGapSetup, dailyRange, findAirGap } from '../utils/airGap';
import { MoomooLists, UniverseId, loadRussell, saveRussell, universeSymbols } from '../utils/universes';
import { enableSound, playAlert } from '../utils/alertSound';
import { etClock } from '../utils/lateDay';

export interface GapAlert {
  id: string;
  type: 'entry' | 'target';
  symbol: string;
  side: 'long' | 'short';
  price: number;
  entry: number;
  target: number;
  targetLabel: string;
  roomAtr: number;
  time: number;
}

export interface GapSettings {
  universe: UniverseId;
  interval: '5m' | '15m';
  /** Fewest ATRs of empty space for an entry to count (and alert) */
  minRoomAtr: number;
  sound: boolean;
  running: boolean;
}

const DEFAULTS: GapSettings = { universe: 'ndx', interval: '5m', minRoomAtr: 1.5, sound: true, running: false };
const KEY = 'airGapSettings';
const CONCURRENCY = 6;
const REFRESH_MS = 30_000;
const FULL_EVERY_MS = 10 * 60_000;

const loadSettings = (): GapSettings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), running: false };
  } catch {
    return DEFAULTS;
  }
};

const todayKey = () => `airGapAlerts:${etClock(Date.now()).date}`;
const loadBoard = (): GapAlert[] => {
  try {
    const v = JSON.parse(localStorage.getItem(todayKey()) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Options {
  watchlist: string[];
  /** Called for every new alert (the app shows a toast) */
  onAlert: (a: GapAlert) => void;
}

/**
 * Scans a list of symbols for air gaps between EMA clouds. It runs while "running" is on, whichever tab is open: one full
 * pass over the list, then a refresh of the best candidates every 30 seconds and a full pass every 10 minutes. New entries
 * (and later target hits) become alerts with an optional sound, kept in a board for the day.
 */
export function useAirGapScanner({ watchlist, onAlert }: Options) {
  const [settings, setSettings] = useState<GapSettings>(loadSettings);
  const [setups, setSetups] = useState<Record<string, AirGapSetup>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [updatedAt, setUpdatedAt] = useState(0);
  // how many of the scanned symbols are up / down on the day (the dashboard's breadth line)
  const [breadth, setBreadth] = useState({ up: 0, down: 0, total: 0 });
  const changes = useRef<Record<string, number>>({});
  const [board, setBoard] = useState<GapAlert[]>(loadBoard);
  const [russell, setRussellState] = useState<string[]>(loadRussell);
  // index lists as Moomoo classifies them (when the app runs locally with Moomoo); the built-in ones are the fallback
  const [listInfo, setListInfo] = useState<Record<string, { source: 'moomoo' | 'fallback'; count: number; note?: string }>>({});
  const moomooLists = useRef<MoomooLists>({});
  const russellRef = useRef(russell);
  russellRef.current = russell;
  const setRussell = useCallback((symbols: string[]) => {
    saveRussell(symbols);
    setRussellState(symbols);
  }, []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const watchRef = useRef(watchlist);
  watchRef.current = watchlist;
  const daily = useRef(new Map<string, { day: string; value: number | null }>());
  const seen = useRef(new Set<string>(loadBoard().map((a) => a.id)));
  const live = useRef<Record<string, AirGapSetup>>({});

  const update = useCallback((patch: Partial<GapSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...next, running: false }));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    if (patch.sound) enableSound();
  }, []);

  const raise = useCallback((a: Omit<GapAlert, 'id'>, breakTime: number | null) => {
    const id = `${a.type}|${a.symbol}|${a.side}|${breakTime ?? 'x'}`;
    if (seen.current.has(id)) return;
    seen.current.add(id);
    const alert: GapAlert = { ...a, id };
    setBoard((b) => {
      const next = [alert, ...b].slice(0, 300);
      try {
        localStorage.setItem(todayKey(), JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    if (settingsRef.current.sound) playAlert(a.type);
    onAlertRef.current(alert);
  }, []);

  // one symbol: candles and the day's usual range, then its air gap
  const scanSymbol = useCallback(async (symbol: string, hot: boolean): Promise<AirGapSetup | null> => {
    const market = RealMarketDataService.getInstance();
    const { interval } = settingsRef.current;
    // a full pass uses Yahoo (hundreds of symbols); the best candidates are re-read from Moomoo's live candles when it is connected
    const { bars, source } = await market.fetchChartWithSource(symbol, interval, interval === '5m' ? '5d' : '1mo', false, hot ? 'scan' : 'yahoo');
    const day = etClock(Date.now()).date;
    let d = daily.current.get(symbol);
    // the day's change, for the breadth line: last price against the previous session's close
    if (bars.length > 1) {
      const lastDay = etClock(bars[bars.length - 1].time).date;
      let k = bars.length - 1;
      while (k >= 0 && etClock(bars[k].time).date === lastDay) k--;
      if (k >= 0 && bars[k].close > 0) changes.current[symbol] = (bars[bars.length - 1].close / bars[k].close - 1) * 100;
    }
    // most symbols have no air gap at all: the day's usual range is only fetched for the ones that do
    if ((!d || d.day !== day) && !findAirGap(symbol, bars, null, {}, source)) return null;
    if (!d || d.day !== day) {
      let value: number | null = null;
      try {
        value = dailyRange(await market.fetchChartData(symbol, '1d', '3mo', false, true));
      } catch {
        /* the gap still works without it */
      }
      d = { day, value };
      daily.current.set(symbol, d);
    }
    return findAirGap(symbol, bars, d.value, {}, source);
  }, []);

  const handle = useCallback(
    (s: AirGapSetup, barMs: number) => {
      const min = settingsRef.current.minRoomAtr;
      // only live data raises alerts: a closed market must not replay the last session's entries
      const fresh = Date.now() - (s.breakTime ?? 0) < Math.max(barMs, 300_000) * 8;
      if (s.state === 'entry' && s.roomAtr >= min && fresh) {
        raise({ type: 'entry', symbol: s.symbol, side: s.side, price: s.price, entry: s.entry, target: s.target, targetLabel: s.targetLabel, roomAtr: s.roomAtr, time: Date.now() }, s.breakTime);
      } else if (s.state === 'target' && fresh && seen.current.has(`entry|${s.symbol}|${s.side}|${s.breakTime ?? 'x'}`)) {
        raise({ type: 'target', symbol: s.symbol, side: s.side, price: s.price, entry: s.entry, target: s.target, targetLabel: s.targetLabel, roomAtr: s.roomAtr, time: Date.now() }, s.breakTime);
      }
    },
    [raise]
  );

  const symbolsOf = useCallback(() => universeSymbols(settingsRef.current.universe, watchRef.current, russellRef.current, moomooLists.current), []);

  /** Ask Moomoo for the lists the chosen universe needs (once per session each) */
  const loadLists = useCallback(async () => {
    const u = settingsRef.current.universe;
    const need: ('ndx' | 'sp500' | 'russell3000')[] = u === 'ndx' ? ['ndx'] : u === 'sp500' ? ['sp500'] : u === 'both' ? ['ndx', 'sp500'] : u === 'russell' ? ['russell3000'] : [];
    for (const name of need) {
      if (moomooLists.current[name]) continue;
      try {
        const r = await RealMarketDataService.getInstance().getUniverse(name);
        moomooLists.current[name] = r.symbols;
        setListInfo((i) => ({ ...i, [name]: { source: 'moomoo', count: r.symbols.length, note: r.plate } }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const fallback = name === 'russell3000' ? russellRef.current.length : name === 'ndx' ? universeSymbols('ndx', []).length : universeSymbols('sp500', []).length;
        setListInfo((i) => ({ ...i, [name]: { source: 'fallback', count: fallback, note: /Unknown endpoint|unreachable|not running/i.test(msg) ? 'Moomoo is not connected here' : msg } }));
      }
    }
  }, []);

  // the scan loop
  useEffect(() => {
    if (!settings.running) return;
    let cancelled = false;
    const barMs = settings.interval === '5m' ? 300_000 : 900_000;

    const pass = async (symbols: string[], full: boolean) => {
      let done = 0, failed = 0;
      const queue = [...symbols];
      if (full) setProgress({ done: 0, total: symbols.length, failed: 0 });
      let lastFlush = 0;
      const flush = (force = false) => {
        if (!force && Date.now() - lastFlush < 700) return;
        lastFlush = Date.now();
        setSetups({ ...live.current });
        setUpdatedAt(Date.now());
        const vals = Object.values(changes.current);
        setBreadth({ up: vals.filter((v) => v > 0).length, down: vals.filter((v) => v < 0).length, total: vals.length });
        if (full) setProgress({ done, total: symbols.length, failed });
      };
      const worker = async () => {
        while (!cancelled) {
          const sym = queue.shift();
          if (!sym) return;
          try {
            const s = await scanSymbol(sym, !full);
            if (s) {
              live.current[sym] = s;
              handle(s, barMs);
            } else delete live.current[sym];
          } catch {
            failed++;
          }
          done++;
          flush();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      flush(true);
    };

    (async () => {
      await loadLists();
      if (cancelled) return;
      live.current = {};
      changes.current = {};
      setSetups({});
      let lastFull = 0;
      let fullEvery = FULL_EVERY_MS;
      while (!cancelled) {
        const now = Date.now();
        if (now - lastFull >= fullEvery || lastFull === 0) {
          lastFull = now;
          await pass(symbolsOf(), true);
          // a long list (the Russell 3000) takes minutes: leave at least as long again before the next full pass
          fullEvery = Math.max(FULL_EVERY_MS, (Date.now() - now) * 1.5);
        } else {
          // the best candidates and anything already in play
          const hot = Object.values(live.current)
            .sort((a, b) => b.score - a.score)
            .slice(0, 40)
            .map((s) => s.symbol);
          await pass(hot, false);
        }
        await sleep(REFRESH_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
    // a change of list or candle size starts a fresh scan
  }, [settings.running, settings.universe, settings.interval, russell.length, scanSymbol, handle, symbolsOf, loadLists]);

  const clearBoard = useCallback(() => {
    setBoard([]);
    seen.current.clear();
    try {
      localStorage.removeItem(todayKey());
    } catch {
      /* storage unavailable */
    }
  }, []);

  // best first: only setups that still have room and have not reached their target
  const ranked = useMemo(
    () =>
      Object.values(setups)
        .filter((s) => s.state !== 'target' && s.roomAtr >= settings.minRoomAtr)
        .sort((a, b) => b.score - a.score),
    [setups, settings.minRoomAtr]
  );

  return { settings, update, setups, ranked, progress, updatedAt, board, clearBoard, russell, setRussell, listInfo, breadth };
}
