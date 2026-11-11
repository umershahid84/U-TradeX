// Cloudflare Pages Function: serves every /api/* request with the same handlers the Vercel
// functions and the Vite dev server use (api/_lib/market.ts).
import { route } from '../../api/_lib/market';

interface Context {
  request: Request;
}

export const onRequestGet = async ({ request }: Context): Promise<Response> => {
  const url = new URL(request.url);
  const result = await route(url.pathname.replace(/^\/api\//, ''), Object.fromEntries(url.searchParams));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers['Cache-Control'] =
    result.status === 200 && result.cacheSeconds
      ? `public, max-age=${result.cacheSeconds}, s-maxage=${result.cacheSeconds}, stale-while-revalidate=${result.cacheSeconds * 2}`
      : 'no-store';
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
};
