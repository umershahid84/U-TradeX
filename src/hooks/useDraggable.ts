import { useCallback, useEffect, useRef, useState } from 'react';

interface Offset {
  x: number;
  y: number;
}

const load = (key: string): Offset => {
  try {
    const v = JSON.parse(localStorage.getItem(`hud:${key}`) ?? 'null');
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v;
  } catch {
    /* none saved */
  }
  return { x: 0, y: 0 };
};

/**
 * Lets a floating panel be dragged by a handle (mouse, touch or pen). The panel keeps its normal CSS position and is
 * shifted by an offset, which is kept inside the chart area and remembered per panel. Double-click the handle to
 * put it back.
 *
 *   const drag = useDraggable('autoPlan');
 *   <div ref={drag.ref} style={drag.style}> <div {...drag.handleProps}>title</div> … </div>
 */
export function useDraggable(key: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<Offset>(() => load(key));
  const start = useRef<{ px: number; py: number; ox: number; oy: number; minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const save = useCallback(
    (o: Offset) => {
      try {
        if (o.x === 0 && o.y === 0) localStorage.removeItem(`hud:${key}`);
        else localStorage.setItem(`hud:${key}`, JSON.stringify(o));
      } catch {
        /* storage unavailable */
      }
    },
    [key]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      // let the buttons in the handle (collapse, close) work
      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
      const el = ref.current;
      const parent = el?.offsetParent as HTMLElement | null;
      if (!el || !parent) return;
      const r = el.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      // how far the panel may move from where it is now, to stay inside its container
      start.current = {
        px: e.clientX,
        py: e.clientY,
        ox: offset.x,
        oy: offset.y,
        minX: offset.x - (r.left - p.left),
        maxX: offset.x + (p.right - r.right),
        minY: offset.y - (r.top - p.top),
        maxY: offset.y + (p.bottom - r.bottom),
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      e.preventDefault();
    },
    [offset.x, offset.y]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const x = Math.min(Math.max(s.ox + e.clientX - s.px, Math.min(s.minX, 0)), Math.max(s.maxX, 0));
    const y = Math.min(Math.max(s.oy + e.clientY - s.py, Math.min(s.minY, 0)), Math.max(s.maxY, 0));
    setOffset({ x, y });
  }, []);

  const end = useCallback(() => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
  }, []);

  // remember where it was left
  useEffect(() => {
    if (!dragging) save(offset);
  }, [dragging, offset, save]);

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return {
    ref,
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` } as React.CSSProperties,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onDoubleClick: reset,
      title: 'Drag to move · double-click to reset',
      style: { cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' as const, userSelect: 'none' as const },
    },
  };
}
