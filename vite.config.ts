import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Serves /api/* locally with the same handlers Vercel runs in production (api/_lib/market.ts)
const marketApi = (): Plugin => ({
  name: 'market-api',
  configureServer(server) {
    server.middlewares.use('/api', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const query = Object.fromEntries(url.searchParams)
      const { route } = await server.ssrLoadModule('/api/_lib/market.ts')
      const result = await route(url.pathname, query)
      res.statusCode = result.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result.body))
    })
  }
})

export default defineConfig({
  plugins: [react(), marketApi()],
  server: {
    port: 3000,
    open: true
  }
})
