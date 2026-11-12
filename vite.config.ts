import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { MoomooQuoteClient, withMoomoo, type MoomooConfig } from './local/moomoo'

// Serves /api/* locally with the same handlers Vercel runs in production (api/_lib/market.ts).
// With MOOMOO_ENABLED=true in .env.local, live quotes come from your Moomoo account through the OpenD
// gateway on this computer (read-only; see local/moomoo.ts) and Yahoo covers everything else.
const marketApi = (moomoo: { client: MoomooQuoteClient; cfg: MoomooConfig } | null): Plugin => ({
  name: 'market-api',
  configureServer(server) {
    server.middlewares.use('/api', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const query = Object.fromEntries(url.searchParams)
      const { route } = await server.ssrLoadModule('/api/_lib/market.ts')
      const handler = moomoo ? withMoomoo(route, moomoo.client, moomoo.cfg) : route
      const result = await handler(url.pathname, query)
      res.statusCode = result.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result.body))
    })
  }
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  let moomoo: { client: MoomooQuoteClient; cfg: MoomooConfig } | null = null
  if (env.MOOMOO_ENABLED === 'true') {
    const cfg: MoomooConfig = {
      host: env.MOOMOO_HOST || '127.0.0.1',
      protocol: env.MOOMOO_PROTOCOL === 'ws' ? 'ws' : 'tcp',
      // OpenD's API port is 11111; its separate WebSocket port (default 33333) is only for MOOMOO_PROTOCOL=ws
      port: Number(env.MOOMOO_PORT) || (env.MOOMOO_PROTOCOL === 'ws' ? 33333 : 11111),
      key: env.MOOMOO_KEY || undefined,
      ssl: env.MOOMOO_SSL === 'true',
      // quotes only from Moomoo (no delayed Yahoo prices) unless MOOMOO_ONLY=false
      only: env.MOOMOO_ONLY !== 'false',
    }
    moomoo = { client: new MoomooQuoteClient(cfg), cfg }
    console.log(`[moomoo] live data from OpenD at ${cfg.host}:${cfg.port} via ${cfg.protocol} (read-only${cfg.only ? ', Moomoo only' : ', Yahoo fallback'})`)
  }
  return {
    plugins: [react(), marketApi(moomoo)],
    server: {
      port: 3000,
      open: true
    }
  }
})
