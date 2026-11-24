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

export interface RosterEntry {
  id: string
  name: string
  chamber: string
  state: string
  party: string
  /** Still serving */
  active: boolean
  /** Lower-case spellings used in disclosures, for matching what you type */
  aliases: string[]
}

interface CacheFile {
  symbol: string
  fetchedAt: number
  total: number
  trades: PoliticianTrade[]
}

const DAY_MS = 24 * 3600 * 1000
const KEEP = 250
const KEEP_PERSON = 400
const ROSTER_MS = 30 * DAY_MS
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

  const save = (file: string, value: unknown) => {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(value))
    } catch {
      /* a read-only folder only costs the cache */
    }
  }

  const fetchAv = async (params: string): Promise<{ ok: true; json: any } | { ok: false; message: string }> => {
    countCall()
    const url = `https://www.alphavantage.co/query?${params}&apikey=${encodeURIComponent(apiKey ?? '')}`
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    const json: any = await res.json()
    return { ok: true, json }
  }
  const avMessage = (json: any) => String(json?.Information ?? json?.Note ?? json?.['Error Message'] ?? 'Alpha Vantage returned no data')

  // everyone who can appear in the data, so a name can be turned into the id Alpha Vantage wants
  const roster = async (): Promise<PoliticiansResult> => {
    const file = join(dir, '_roster.json')
    const cached = readJson<{ fetchedAt: number; politicians: RosterEntry[] }>(file)
    if (cached && Date.now() - cached.fetchedAt < ROSTER_MS) return { status: 200, body: { ...cached, cached: true } }
    if (!apiKey) {
      if (cached) return { status: 200, body: { ...cached, cached: true, stale: true } }
      return { status: 400, body: { error: 'Add ALPHAVANTAGE_API_KEY=your_key to .env.local and restart npm run dev to search by politician.' } }
    }
    try {
      const r = await fetchAv('function=POLITICIAN_METADATA')
      const list = r.ok ? r.json?.politicians : null
      if (!Array.isArray(list)) {
        const msg = r.ok ? avMessage(r.json) : 'No data'
        return cached ? { status: 200, body: { ...cached, cached: true, stale: true, note: msg } } : { status: 502, body: { error: msg } }
      }
      const now = new Date().toISOString().slice(0, 10)
      const politicians: RosterEntry[] = list
        .map((p: any): RosterEntry => ({
          id: String(p.bioguide_id ?? ''),
          name: String(p.display_name ?? ''),
          chamber: String(p.chamber ?? '').toUpperCase(),
          state: String(p.state ?? ''),
          party: String(p.party ?? ''),
          active: Array.isArray(p.terms) && p.terms.some((t: any) => String(t.end_date ?? '') >= now),
          aliases: Array.isArray(p.aliases) ? p.aliases.slice(0, 4).map((a: unknown) => String(a)) : [],
        }))
        .filter((p: RosterEntry) => p.id && p.name)
        .sort((a: RosterEntry, b: RosterEntry) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      const fresh = { fetchedAt: Date.now(), politicians }
      save(file, fresh)
      return { status: 200, body: { ...fresh, cached: false } }
    } catch (e) {
      const msg = `Alpha Vantage request failed: ${e instanceof Error ? e.message : String(e)}`
      return cached ? { status: 200, body: { ...cached, cached: true, stale: true, note: msg } } : { status: 502, body: { error: msg } }
    }
  }

  const trades = async (query: Record<string, string>): Promise<PoliticiansResult> => {
    const symbol = (query.symbol ?? '').trim().toUpperCase()
    const bio = (query.bioguide_id ?? '').trim().toUpperCase()
    const byPerson = !!bio
    if (byPerson ? !/^[A-Z]\d{6}$/.test(bio) : !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return { status: 400, body: { error: 'A stock symbol or a politician is required' } }
    const id = byPerson ? bio : symbol
    const file = join(dir, `${byPerson ? 'bio_' : ''}${id.replace(/[^A-Z0-9]/g, '_')}.json`)
    const cached = readJson<CacheFile>(file)
    const age = cached ? Date.now() - cached.fetchedAt : Infinity
    const forced = query.refresh === '1' && age > MIN_REFRESH_MS
    const reply = (c: CacheFile, extra: Record<string, unknown> = {}) => ({
      status: 200,
      body: { symbol: byPerson ? '' : symbol, bioguideId: byPerson ? bio : '', source: 'Alpha Vantage', fetchedAt: c.fetchedAt, total: c.total, trades: c.trades, callsToday: callsToday(), ...extra },
    })

    if (cached && age < DAY_MS && !forced) return reply(cached, { cached: true })
    // a sweep over many symbols asks for cache only, so it never spends the daily allowance
    if (query.cacheOnly === '1') return { status: 200, body: { symbol, bioguideId: bio, source: 'Alpha Vantage', skipped: true, trades: cached?.trades ?? [], fetchedAt: cached?.fetchedAt ?? 0, total: cached?.total ?? 0, callsToday: callsToday() } }

    if (!apiKey) {
      if (cached) return reply(cached, { cached: true, stale: true, note: 'No ALPHAVANTAGE_API_KEY set: showing saved data' })
      return { status: 400, body: { error: 'Add ALPHAVANTAGE_API_KEY=your_key to .env.local and restart npm run dev. Get a free key at alphavantage.co/support/#api-key' } }
    }

    try {
      const r = await fetchAv(byPerson ? `function=CONGRESS_TRADES&bioguide_id=${encodeURIComponent(bio)}` : `function=CONGRESS_TRADES&symbol=${encodeURIComponent(symbol)}`)
      const json = r.ok ? r.json : null
      if (!Array.isArray(json?.trades)) {
        // rate limit, premium-only or bad key: Alpha Vantage answers with a plain message
        const msg = avMessage(json)
        if (cached) return reply(cached, { cached: true, stale: true, note: msg })
        return { status: 502, body: { error: msg } }
      }
      const list: PoliticianTrade[] = (json.trades as any[])
        .map(normalize)
        .filter((t) => t.tradeDate)
        .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
        .slice(0, byPerson ? KEEP_PERSON : KEEP)
      const fresh: CacheFile = { symbol: id, fetchedAt: Date.now(), total: num(json.trades_total_count) || list.length, trades: list }
      save(file, fresh)
      return reply(fresh, { cached: false })
    } catch (e) {
      const msg = `Alpha Vantage request failed: ${e instanceof Error ? e.message : String(e)}`
      if (cached) return reply(cached, { cached: true, stale: true, note: msg })
      return { status: 502, body: { error: msg } }
    }
  }

  return async (path: string, query: Record<string, string>): Promise<PoliticiansResult> => (path === '/politicians/list' ? roster() : trades(query))
}
