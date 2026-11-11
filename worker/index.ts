// Cloudflare Worker: serves /api/* with the same handlers the Vercel functions and the Vite dev
// server use (api/_lib/market.ts). Everything else is the static site from dist/ (see wrangler.toml).
import { route } from '../api/_lib/market';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    let result: Awaited<ReturnType<typeof route>>;
    try {
      result = await route(url.pathname.replace(/^\/api\//, ''), Object.fromEntries(url.searchParams));
    } catch (e) {
      // always answer with JSON so the app can show the real reason instead of "server unreachable"
      result = { status: 500, body: { error: `API error: ${e instanceof Error ? e.message : String(e)}` } };
    }
    const cache =
      result.status === 200 && result.cacheSeconds
        ? `public, max-age=${result.cacheSeconds}, s-maxage=${result.cacheSeconds}, stale-while-revalidate=${result.cacheSeconds * 2}`
        : 'no-store';
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
    });
  },
};
