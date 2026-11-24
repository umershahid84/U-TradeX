// Local-only politicians' trades (US Congress stock disclosures) from Alpha Vantage's CONGRESS_TRADES.
// Runs only inside the local dev server (vite.config.ts), never on the deployed site, so your key stays on this computer.
// Alpha Vantage's free tier is small, so every answer is cached on disk and a symbol is only refetched after a day.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface PoliticianTrade {
  chamber: string
  politician: string
  bioguideId: string
  party: string
  state: string
  symbol: string
  assetName: string
  assetType: string
  /** BUY, SELL, ... as reported */
  type: string
  /** YYYY-MM-DD the trade happened */
  tradeDate: string
  /** YYYY-MM-DD it was filed with Congress (up to 45 days later by law) */
  filedDate: string
  amountMin: number
  amountMax: number
  /** SELF, SPOUSE, DEPENDENT, JOINT ... */
  owner: string
  status: string
}

interface CacheFile {
  symbol: string
  fetchedAt: number
  total: number
  trades: PoliticianTrade[]
}

const DAY_MS = 24 * 3600 * 1000
const KEEP = 250
const MIN_REFRESH_MS = 10 * 60 * 1000

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const normalize = (t: any): PoliticianTrade => ({
  chamber: String(t.chamber ?? ''),
  politician: String(t.politician_canonical || t.politician || ''),
  bioguideId: String(t.bioguide_id ?? ''),
  party: String(t.party ?? ''),
  state: String(t.state ?? ''),
  symbol: String(t.symbol || t.ticker_reported || ''),
  assetName: String(t.asset_name ?? ''),
  assetType: String(t.asset_type_code ?? ''),
  type: String(t.transaction_type ?? '').toUpperCase(),
  tradeDate: String(t.transaction_date ?? ''),
  filedDate: String(t.filed_date || t.notification_date || ''),
  amountMin: num(t.amount_min),
  amountMax: num(t.amount_max),
  owner: String(t.owner_code ?? ''),
  status: String(t.filing_status ?? ''),
})

export interface PoliticiansResult {
  status: number
  body: unknown
}

export const createPoliticiansRoute = (apiKey: string | undefined, cacheDir: string) => {
  const dir = join(cacheDir, 'politicians')
  const usageFile = join(dir, '_usage.json')

  const readJson = <T>(file: string): T | null => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
    } catch {
      return null
    }
  }
  const today = () => new Date().toISOString().slice(0, 10)
  const callsToday = (): number => {
    const u = readJson<{ day: string; calls: number }>(usageFile)
    return u && u.day === today() ? u.calls : 0
  }
  const countCall = () => {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(usageFile, JSON.stringify({ day: today(), calls: callsToday() + 1 }))
    } catch {
      /* the count is only informational */
    }
  }

  return async (query: Record<string, string>): Promise<PoliticiansResult> => {
    const symbol = (query.symbol ?? '').trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return { status: 400, body: { error: 'A stock symbol is required' } }
    const file = join(dir, `${symbol.replace(/[^A-Z0-9]/g, '_')}.json`)
    const cached = readJson<CacheFile>(file)
    const age = cached ? Date.now() - cached.fetchedAt : Infinity
    const forced = query.refresh === '1' && age > MIN_REFRESH_MS
    const reply = (c: CacheFile, extra: Record<string, unknown> = {}) => ({
      status: 200,
      body: { symbol, source: 'Alpha Vantage', fetchedAt: c.fetchedAt, total: c.total, trades: c.trades, callsToday: callsToday(), ...extra },
    })

    if (cached && age < DAY_MS && !forced) return reply(cached, { cached: true })
    // a sweep over many symbols asks for cache only, so it never spends the daily allowance
    if (query.cacheOnly === '1') return { status: 200, body: { symbol, source: 'Alpha Vantage', skipped: true, trades: cached?.trades ?? [], fetchedAt: cached?.fetchedAt ?? 0, total: cached?.total ?? 0, callsToday: callsToday() } }

    if (!apiKey) {
      if (cached) return reply(cached, { cached: true, stale: true, note: 'No ALPHAVANTAGE_API_KEY set: showing saved data' })
      return { status: 400, body: { error: 'Add ALPHAVANTAGE_API_KEY=your_key to .env.local and restart npm run dev. Get a free key at alphavantage.co/support/#api-key' } }
    }

    try {
      countCall()
      const url = `https://www.alphavantage.co/query?function=CONGRESS_TRADES&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) })
      const json: any = await res.json()
      if (!Array.isArray(json?.trades)) {
        // rate limit, premium-only or bad key: Alpha Vantage answers with a plain message
        const msg = String(json?.Information ?? json?.Note ?? json?.['Error Message'] ?? 'Alpha Vantage returned no trade data')
        if (cached) return reply(cached, { cached: true, stale: true, note: msg })
        return { status: 502, body: { error: msg } }
      }
      const trades: PoliticianTrade[] = (json.trades as any[])
        .map(normalize)
        .filter((t) => t.tradeDate)
        .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
        .slice(0, KEEP)
      const fresh: CacheFile = { symbol, fetchedAt: Date.now(), total: num(json.trades_total_count) || trades.length, trades }
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, JSON.stringify(fresh))
      } catch {
        /* a read-only folder only costs the cache */
      }
      return reply(fresh, { cached: false })
    } catch (e) {
      const msg = `Alpha Vantage request failed: ${e instanceof Error ? e.message : String(e)}`
      if (cached) return reply(cached, { cached: true, stale: true, note: msg })
      return { status: 502, body: { error: msg } }
    }
  }
}
