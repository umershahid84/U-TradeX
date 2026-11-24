import axios from 'axios';

export interface PoliticianTrade {
  chamber: string;
  politician: string;
  bioguideId: string;
  party: string;
  state: string;
  symbol: string;
  assetName: string;
  assetType: string;
  type: string;
  tradeDate: string;
  filedDate: string;
  amountMin: number;
  amountMax: number;
  owner: string;
  status: string;
}

export interface PoliticiansData {
  symbol: string;
  source: string;
  fetchedAt: number;
  total: number;
  trades: PoliticianTrade[];
  cached?: boolean;
  stale?: boolean;
  skipped?: boolean;
  note?: string;
  callsToday: number;
}

const memory = new Map<string, { at: number; data: PoliticiansData }>();
const MEMORY_MS = 5 * 60 * 1000;

/**
 * Trades for one symbol from the local server (Alpha Vantage, cached on disk for a day). Only the local dev server has
 * this route, so on the deployed site it fails with a message saying so.
 */
export async function fetchPoliticianTrades(symbol: string, opts: { refresh?: boolean; cacheOnly?: boolean } = {}): Promise<PoliticiansData> {
  const key = `${symbol}|${opts.cacheOnly ? 'c' : ''}`;
  const hit = memory.get(key);
  if (hit && !opts.refresh && Date.now() - hit.at < MEMORY_MS) return hit.data;
  try {
    const res = await axios.get<PoliticiansData>('/api/politicians', {
      params: { symbol, ...(opts.refresh ? { refresh: '1' } : {}), ...(opts.cacheOnly ? { cacheOnly: '1' } : {}) },
      timeout: 60000,
    });
    if (!res.data || typeof res.data !== 'object' || !Array.isArray(res.data.trades)) throw new Error('unavailable');
    memory.set(key, { at: Date.now(), data: res.data });
    return res.data;
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const detail = (e.response?.data as { error?: string } | undefined)?.error;
      if (detail && /Unknown endpoint/i.test(detail)) throw new Error('Politicians’ trades run only when you start the app on your own computer (npm run dev with an Alpha Vantage key in .env.local).');
      throw new Error(detail || 'The local server did not answer. Start the app with npm run dev.');
    }
    throw e instanceof Error ? e : new Error('Politicians’ trades are unavailable');
  }
}

const DAY_MS = 24 * 3600 * 1000;

/** Days between the trade and the filing (the law allows up to 45) */
export const filingDelayDays = (t: PoliticianTrade): number | null => {
  const a = Date.parse(`${t.tradeDate}T12:00:00Z`);
  const b = Date.parse(`${t.filedDate}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / DAY_MS)) : null;
};

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`);

/** Disclosures only give a range, never an exact amount */
export const amountRange = (t: PoliticianTrade): string =>
  t.amountMin || t.amountMax ? `$${short(t.amountMin)}–$${short(t.amountMax)}` : 'n/a';

export const tradeSide = (t: PoliticianTrade): 'buy' | 'sell' | 'other' =>
  t.type.includes('BUY') || t.type === 'PURCHASE' ? 'buy' : t.type.includes('SELL') || t.type.includes('SALE') ? 'sell' : 'other';

export const ownerLabel = (code: string): string => {
  const c = code.toUpperCase();
  return c === 'SELF' || c === '' ? 'Self' : c.startsWith('SP') ? 'Spouse' : c.startsWith('DC') || c.startsWith('DEP') ? 'Dependent' : c.startsWith('JT') || c.startsWith('JOINT') ? 'Joint' : code;
};
