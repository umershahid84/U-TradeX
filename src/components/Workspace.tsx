import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COLS, Rect, Rects, compact, loadRects, rowsOf, saveRects } from '../utils/gridLayout';
import './Workspace.css';

export interface PanelDef {
  id: string;
  title: string;
  node: React.ReactNode;
  min: { w: number; h: number };
  /** When set the panel is folded: it shrinks to this many rows (the panels below move up) and its saved size is kept */
  collapsedH?: number;
}

interface Props {
  /** Where this arrangement is remembered (one per layout name) */
  storageKey: string;
  panels: PanelDef[];
  defaults: Rects;
  /** Rows the default arrangement spans: the workspace height is divided into this many rows */
  rows: number;
  locked: boolean;
  /** Changes when the arrangement should go back to its default */
  resetToken: number;
}

/**
 * A free-form workspace: every panel can be dragged by its grip bar and resized from its bottom-right corner. Panels
 * snap to a 12-column grid, never overlap and float up to fill gaps; the arrangement is saved per layout.
 */
export const Workspace: React.FC<Props> = ({ storageKey, panels, defaults, rows, locked, resetToken }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  useEffect(() => {
    const el = rootRef.current?.parentElement;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const cellW = size.w / COLS;
  const rowH = Math.max(22, size.h / rows);

  const ids = useMemo(() => panels.map((p) => p.id), [panels]);
  const [rects, setRects] = useState<Rects>(() => loadRects(storageKey, defaults));
  // another layout, or a reset: load its arrangement
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setRects(loadRects(storageKey, defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const resetSeen = useRef(resetToken);
  useEffect(() => {
    if (resetSeen.current === resetToken) return;
    resetSeen.current = resetToken;
    setRects(defaults);
    saveRects(storageKey, defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  const base: Rects = useMemo(() => {
    const fold = panels.filter((p) => p.collapsedH && rects[p.id]);
    if (!fold.length) return rects;
    const next = { ...rects };
    fold.forEach((p) => { next[p.id] = { ...rects[p.id], h: Math.min(rects[p.id].h, p.collapsedH!) }; });
    return compact(next);
  }, [rects, panels]);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; px: number; py: number; orig: Rect; dx: number; dy: number } | null>(null);
  const minOf = (id: string) => panels.find((p) => p.id === id)?.min ?? { w: 2, h: 3 };

  const shown: Rects = useMemo(() => {
    if (!drag) return base;
    const o = drag.orig;
    const next: Rect =
      drag.mode === 'move'
        ? { ...o, x: Math.max(0, Math.min(COLS - o.w, Math.round(o.x + drag.dx / cellW))), y: Math.max(0, Math.round(o.y + drag.dy / rowH)) }
        : { ...o, w: Math.max(minOf(drag.id).w, Math.min(COLS - o.x, Math.round(o.w + drag.dx / cellW))), h: Math.max(minOf(drag.id).h, Math.round(o.h + drag.dy / rowH)) };
    return compact({ ...base, [drag.id]: next }, drag.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, drag, cellW, rowH]);

  const start = (id: string, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (locked || e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, px: e.clientX, py: e.clientY, orig: base[id], dx: 0, dy: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.px, dy: e.clientY - drag.py });
  };
  const end = () => {
    if (!drag) return;
    const folded = panels.filter((p) => p.collapsedH && !(drag.id === p.id && drag.mode === 'resize'));
    const keep = { ...shown };
    folded.forEach((p) => { if (rects[p.id]) keep[p.id] = { ...keep[p.id], h: rects[p.id].h }; });
    const done = compact(keep, drag.id);
    setRects(done);
    saveRects(storageKey, done);
    setDrag(null);
  };

  const used = rowsOf(shown);
  return (
    <div ref={rootRef} className={`ws ${drag ? 'dragging' : ''} ${locked ? 'locked' : ''}`} style={{ height: Math.max(used, rows) * rowH }}>
      {ids.map((id) => {
        const panel = panels.find((p) => p.id === id)!;
        const r = shown[id] ?? defaults[id];
        const moving = drag?.id === id && drag.mode === 'move';
        const style: React.CSSProperties = {
          left: moving ? drag!.orig.x * cellW + drag!.dx : r.x * cellW,
          top: moving ? drag!.orig.y * rowH + drag!.dy : r.y * rowH,
          width: r.w * cellW,
          height: r.h * rowH,
        };
        return (
          <React.Fragment key={id}>
            {moving && <div className="ws-ghost" style={{ left: r.x * cellW, top: r.y * rowH, width: r.w * cellW, height: r.h * rowH }} />}
            <div className={`ws-cell ${moving ? 'moving' : ''}`} style={style} data-panel={id}>
              <div className="ws-inner">
                {!locked && (
                  <div className="ws-grip" title="Drag to move this panel" onPointerDown={start(id, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                    ⠿ {panel.title}
                  </div>
                )}
                <div className="ws-body">{panel.node}</div>
              </div>
              {!locked && <div className="ws-resize" title="Drag to resize" onPointerDown={start(id, 'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
