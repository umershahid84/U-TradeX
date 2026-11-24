import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
    const x = Math.max(Math.min(s.ox + e.clientX - s.px, Math.max(s.maxX, 0)), Math.min(s.minX, 0));
    const y = Math.max(Math.min(s.oy + e.clientY - s.py, Math.max(s.maxY, 0)), Math.min(s.minY, 0));
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

  // keep the panel on screen when the window or the panel changes size (a position saved on a bigger screen would
  // otherwise leave the title bar out of reach)
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const fit = () => {
      if (start.current) return;
      const o = offsetRef.current;
      const r = el.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      if (!r.width || !p.width) return;
      const baseLeft = r.left - o.x, baseTop = r.top - o.y;
      // the panel's top-left corner may sit anywhere that keeps it inside the container
      const minX = p.left - baseLeft, maxX = p.right - r.width - baseLeft;
      const minY = p.top - baseTop, maxY = p.bottom - r.height - baseTop;
      const x = Math.round(Math.max(Math.min(o.x, Math.max(maxX, 0)), Math.min(minX, 0)));
      const y = Math.round(Math.max(Math.min(o.y, Math.max(maxY, 0)), Math.min(minY, 0)));
      if (x !== o.x || y !== o.y) setOffset({ x, y });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

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
