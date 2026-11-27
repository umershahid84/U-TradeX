// A tiny grid layout for draggable, resizable dashboard panels: positions are in grid units (12 columns), panels never
// overlap, and after every move the panels float up to fill the gaps (vertical compaction).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Rects = Record<string, Rect>;

export const COLS = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Makes a layout valid: every panel inside the grid, none overlapping, none with empty space above it. The `fixed`
 * panel (the one being dragged or resized) keeps its position and the others are placed around it.
 */
export const compact = (rects: Rects, fixed?: string): Rects => {
  const ids = Object.keys(rects).sort((a, b) => (a === fixed ? -1 : b === fixed ? 1 : rects[a].y - rects[b].y || rects[a].x - rects[b].x));
  const placed: Rects = {};
  for (const id of ids) {
    const w = clamp(Math.round(rects[id].w), 1, COLS);
    const r: Rect = { x: clamp(Math.round(rects[id].x), 0, COLS - w), y: Math.max(0, Math.round(rects[id].y)), w, h: Math.max(1, Math.round(rects[id].h)) };
    if (id !== fixed) {
      r.y = 0;
      while (Object.values(placed).some((p) => overlaps(p, r))) r.y++;
    }
    placed[id] = r;
  }
  return placed;
};

/** Rows used by a layout */
export const rowsOf = (rects: Rects): number => Object.values(rects).reduce((m, r) => Math.max(m, r.y + r.h), 0);

export const loadRects = (key: string, fallback: Rects): Rects => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (v && typeof v === 'object') {
      const out: Rects = {};
      for (const id of Object.keys(fallback)) {
        const r = v[id];
        out[id] = r && [r.x, r.y, r.w, r.h].every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) ? r : fallback[id];
      }
      return compact(out);
    }
  } catch {
    /* use the default */
  }
  return fallback;
};

export const saveRects = (key: string, rects: Rects) => {
  try {
    localStorage.setItem(key, JSON.stringify(rects));
  } catch {
    /* storage unavailable */
  }
};
