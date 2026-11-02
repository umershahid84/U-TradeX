import { ChartData } from '../types';

export interface FuturesMove {
  symbol: string;
  /** Latest futures price */
  price: number;
  /** Change since the 4:00 pm New York cash close, as a fraction */
  change: number;
}

const nyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

const nyMinutes = (ms: number): number => {
  const p: Record<string, number> = {};
  nyParts.formatToParts(new Date(ms)).forEach((x) => { if (x.type !== 'literal') p[x.type] = +x.value; });
  return p.hour * 60 + p.minute;
};

/**
 * How far a futures contract has moved since the most recent 4:00 pm New York cash close, from
 * 5-minute bars. The bar that starts at 15:55 is the last one before the close. Returns null when
 * there is no such bar in the data (e.g. it is older than the bars provided).
 */
export const futuresMoveSinceClose = (symbol: string, bars: ChartData[], maxAgeMs = 5 * 24 * 3600 * 1000): FuturesMove | null => {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  for (let i = bars.length - 1; i >= 0; i--) {
    if (last.time - bars[i].time > maxAgeMs) break;
    if (nyMinutes(bars[i].time) === 15 * 60 + 55) {
      const ref = bars[i].close;
      if (!(ref > 0)) return null;
      return { symbol, price: last.close, change: last.close / ref - 1 };
    }
  }
  return null;
};

/** Symbols that already trade around the clock, where this context line would be redundant */
export const tradesAroundTheClock = (symbol: string): boolean => /=F$|=X$|-USD$|^\^/.test(symbol.toUpperCase());
