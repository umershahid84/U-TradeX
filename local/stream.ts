// Live prices pushed to the browser (Server-Sent Events) from Moomoo OpenD's own pushes. Read-only: it only receives
// quotes and order books, it can never send an order. Local dev server only.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MoomooQuoteClient, toMoomooCode, toQuoteBody } from './moomoo'
import { errText } from './transport'

const FLUSH_MS = 100 // at most ten updates a second per symbol or contract
const PING_MS = 15_000
const MAX_CONTRACTS = 20

interface ContractState {
  key: string
  bid: number
  ask: number
  last: number
  iv: number
}

/**
 * GET /api/stream?symbol=AAPL&prepost=true&contracts=SPY|2026-11-27|760|call,...
 * Events: `ready` (what is live), `quote` (the stock, same shape as /api/quote), `contract` (one option contract,
 * same shape as one entry of /api/optionquotes) and `problem` (why streaming is not available).
 */
export async function handleStream(client: MoomooQuoteClient, req: IncomingMessage, res: ServerResponse, query: Record<string, string | undefined>): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 3000\n\n')
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const symbol = (query.symbol ?? '').trim()
  const code = symbol ? toMoomooCode(symbol) : null
  const prepost = query.prepost === 'true'
  const keys = (query.contracts ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_CONTRACTS)

  const offs: (() => void)[] = []
  let timer: NodeJS.Timeout | null = null
  let ping: NodeJS.Timeout | null = null
  const stop = () => {
    offs.forEach((f) => f())
    offs.length = 0
    if (timer) clearInterval(timer)
    if (ping) clearInterval(ping)
    timer = ping = null
    if (!res.writableEnded) res.end()
  }
  req.on('close', stop)

  try {
    const live: { symbol?: string; contracts: string[] } = { contracts: [] }
    if (code) {
      const ok = await client.watch([code])
      if (ok.length) live.symbol = symbol
    }
    const byContract = new Map<string, ContractState>()
    if (keys.length) {
      const resolved = await client.resolveContracts(keys)
      const ok = new Set(await client.watch(resolved.map((r) => r.contract), true))
      for (const r of resolved) {
        if (!ok.has(r.contract)) continue
        byContract.set(r.contract.toUpperCase(), { key: r.key, bid: 0, ask: 0, last: 0, iv: 0 })
        live.contracts.push(r.key)
      }
      // first values right away, before the first push
      for (const q of await client.contractQuotes(live.contracts)) {
        const st = [...byContract.values()].find((s) => s.key === q.key)
        if (st) Object.assign(st, { bid: q.bid, ask: q.ask, last: q.last, iv: q.iv })
        send('contract', q)
      }
    }
    if (!live.symbol && !live.contracts.length) {
      send('problem', { message: client.note || client.lastError || 'Nothing to stream' })
      stop()
      return
    }
    send('ready', live)

    // updates are coalesced so a burst of pushes becomes one message
    const pending = new Map<string, { event: string; data: unknown }>()
    const queue = (id: string, event: string, data: unknown) => pending.set(id, { event, data })
    const mark = (s: ContractState) => (s.bid > 0 && s.ask > 0 ? (s.bid + s.ask) / 2 : s.last)

    offs.push(
      client.onQuote((c, qot) => {
        if (code && c === code && live.symbol) {
          const body = toQuoteBody(symbol, qot, prepost)
          if (body && body.price !== null && body.price > 0) queue('stock', 'quote', { ...body, source: 'moomoo', live: true })
          return
        }
        const st = byContract.get(c)
        if (st) {
          const last = Number(qot.curPrice ?? 0)
          if (last > 0) st.last = last
          const iv = Number(qot.optionExData?.impliedVolatility ?? 0) / 100
          if (iv > 0) st.iv = iv
          queue(c, 'contract', { key: st.key, bid: st.bid, ask: st.ask, last: st.last, mark: mark(st), iv: st.iv })
        }
      }),
      client.onBook((c, book) => {
        const st = byContract.get(c)
        if (!st) return
        if (book.bid > 0) st.bid = book.bid
        if (book.ask > 0) st.ask = book.ask
        queue(c, 'contract', { key: st.key, bid: st.bid, ask: st.ask, last: st.last, mark: mark(st), iv: st.iv })
      })
    )
    timer = setInterval(() => {
      for (const { event, data } of pending.values()) send(event, data)
      pending.clear()
    }, FLUSH_MS)
    ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), PING_MS)
  } catch (e) {
    send('problem', { message: errText(e) })
    stop()
  }
}
