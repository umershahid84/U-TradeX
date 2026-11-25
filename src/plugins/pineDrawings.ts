// Draws what Pine scripts put on the chart: lines (line.new), boxes (box.new) and labels (label.new).
// Positions are candle numbers (bar_index) or times; candles beyond the last one are extrapolated.
import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { PineBox, PineLabel, PineLine } from '../pine';

export interface Drawings {
  lines: PineLine[];
  boxes: PineBox[];
  labels: PineLabel[];
  /** bgcolor(): background colour per candle */
  bg?: (string | undefined)[];
}

const SIZES: Record<string, number> = { tiny: 8, small: 10, normal: 12, large: 16, huge: 22, auto: 11 };

export class PineDrawingsPrimitive implements ISeriesPrimitive<Time> {
  private data: Drawings = { lines: [], boxes: [], labels: [] };
  private bars: { time: number; high: number; low: number }[] = [];
  private series: ISeriesApi<'Candlestick'> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;

  set(data: Drawings, bars: { time: number; high: number; low: number }[]) {
    this.data = data;
    this.bars = bars;
    this.requestUpdate?.();
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const top: IPrimitivePaneRenderer = { draw: (t: CanvasRenderingTarget2D) => this.draw(t) };
    const bottom: IPrimitivePaneRenderer = { draw: (t: CanvasRenderingTarget2D) => this.drawBackground(t) };
    return [
      { zOrder: () => 'bottom', renderer: () => bottom },
      { zOrder: () => 'top', renderer: () => top },
    ];
  }

  /** Horizontal pixel position of a candle number or a time (ms) */
  private px(x: number, timeX: boolean): number | null {
    const chart = this.chart;
    if (!chart) return null;
    const ts = chart.timeScale();
    if (timeX) return ts.timeToCoordinate((x / 1000) as Time);
    const c = ts.logicalToCoordinate(x as never);
    return c === null ? null : (c as number);
  }

  /** bgcolor(): a vertical band behind each coloured candle */
  private drawBackground(target: CanvasRenderingTarget2D) {
    const bg = this.data.bg;
    const chart = this.chart;
    if (!bg || !chart) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(bg.length - 1, Math.ceil(range.to) + 1);
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr }) => {
      const a0 = ts.logicalToCoordinate(from as never), a1 = ts.logicalToCoordinate((from + 1) as never);
      const step = a0 !== null && a1 !== null ? Math.abs((a1 as number) - (a0 as number)) : 6;
      for (let i = from; i <= to; i++) {
        const col = bg[i];
        if (!col) continue;
        const x = ts.logicalToCoordinate(i as never);
        if (x === null) continue;
        ctx.fillStyle = col;
        ctx.fillRect(((x as number) - step / 2) * hr, 0, step * hr + 1, bitmapSize.height);
      }
    });
  }

  private draw(target: CanvasRenderingTarget2D) {
    const series = this.series;
    if (!series || !this.chart) return;
    const py = (p: number) => series.priceToCoordinate(p);
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const W = bitmapSize.width;
      const dash = (style?: string) => (style?.includes('dashed') ? [6 * hr, 4 * hr] : style?.includes('dotted') ? [2 * hr, 3 * hr] : []);

      for (const b of this.data.boxes) {
        const x1 = this.px(b.left, b.timeX), x2 = this.px(b.right, b.timeX), y1 = py(b.top), y2 = py(b.bottom);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        const l = Math.min(x1, x2) * hr, w = Math.abs(x2 - x1) * hr, t = Math.min(y1, y2) * vr, h = Math.abs(y2 - y1) * vr;
        if (b.bg) { ctx.fillStyle = b.bg; ctx.fillRect(l, t, w, h); }
        if (b.border) {
          ctx.strokeStyle = b.border;
          ctx.lineWidth = Math.max(1, b.borderWidth * hr);
          ctx.setLineDash(dash(b.borderStyle));
          ctx.strokeRect(l, t, w, h);
          ctx.setLineDash([]);
        }
        if (b.text) {
          ctx.font = `${Math.round(10 * vr)}px sans-serif`;
          ctx.fillStyle = b.textColor ?? '#d1d4dc';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.text, l + 4 * hr, t + h / 2);
        }
      }

      for (const ln of this.data.lines) {
        const x1 = this.px(ln.x1, ln.timeX), x2 = this.px(ln.x2, ln.timeX);
        const y1 = py(ln.y1), y2 = py(ln.y2);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        let ax = x1 * hr, ay = y1 * vr, bx = x2 * hr, by = y2 * vr;
        const ext = ln.extend ?? '';
        if (ext.includes('right') || ext.includes('both')) { const k = bx === ax ? 0 : (by - ay) / (bx - ax); bx = W; by = ay + k * (W - ax); }
        if (ext.includes('left') || ext.includes('both')) { const k = bx === ax ? 0 : (by - ay) / (bx - ax); ay = ay + k * (0 - ax); ax = 0; }
        ctx.strokeStyle = ln.color ?? '#2962FF';
        ctx.lineWidth = Math.max(1, ln.width * hr);
        ctx.setLineDash(dash(ln.style));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const lb of this.data.labels) {
        const x = this.px(lb.x, lb.timeX);
        if (x === null) continue;
        let y: number | null = null;
        const bar = lb.timeX ? undefined : this.bars[Math.round(lb.x)];
        const yloc = lb.yloc ?? '';
        if (yloc.includes('abovebar') && bar) y = py(bar.high);
        else if (yloc.includes('belowbar') && bar) y = py(bar.low);
        else if (lb.y !== null) y = py(lb.y);
        if (y === null) continue;
        const size = Math.round((SIZES[(lb.size ?? 'size.normal').replace('size.', '')] ?? 11) * vr);
        ctx.font = `${size}px sans-serif`;
        const style = lb.style ?? '';
        const lines = lb.text.split('\n');
        const tw = Math.max(0, ...lines.map((s) => ctx.measureText(s).width));
        const pad = 4 * hr, lh = size * 1.25;
        const w = tw + pad * 2, h = lines.length * lh + pad;
        const px = x * hr, pyy = y * vr;
        // where the box sits relative to the point it labels
        let left = px - w / 2, top = pyy - h / 2;
        if (style.includes('label_left')) { left = px + 4 * hr; top = pyy - h / 2; }
        else if (style.includes('label_right')) { left = px - w - 4 * hr; top = pyy - h / 2; }
        else if (style.includes('label_up')) { top = pyy + 6 * vr; }
        else if (style.includes('label_down') || yloc.includes('abovebar')) { top = pyy - h - 6 * vr; }
        else if (yloc.includes('belowbar')) { top = pyy + 6 * vr; }
        if (!style.includes('none')) {
          ctx.fillStyle = lb.color ?? 'rgba(41,98,255,0.85)';
          ctx.fillRect(left, top, w, h);
        }
        ctx.fillStyle = lb.textColor ?? '#ffffff';
        ctx.textBaseline = 'top';
        lines.forEach((s, k) => ctx.fillText(s, left + pad, top + pad / 2 + k * lh));
      }
    });
  }
}
