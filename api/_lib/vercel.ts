import type { VercelRequest, VercelResponse } from '@vercel/node';
import { route } from './market';

export const vercelHandler = (path: string) => async (req: VercelRequest, res: VercelResponse) => {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) query[k] = Array.isArray(v) ? v[0] : v;

  const result = await route(path, query);
  if (result.status === 200 && result.cacheSeconds) {
    res.setHeader('Cache-Control', `public, s-maxage=${result.cacheSeconds}, stale-while-revalidate=${result.cacheSeconds * 2}`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.status(result.status).json(result.body);
};
