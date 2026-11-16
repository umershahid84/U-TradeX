// Chart primitive that draws price gaps as shaded zones between the previous close and the next open. An
// open gap stays on the chart to the right edge until price trades back through it; a filled gap ends there.
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Gap } from '../utils/gaps';

const UP = '38, 166, 154';
const DOWN = '239, 83, 80';
const MUTED = '138, 143, 181';

export class GapZonesPrimitive implements ISeriesPrimitive<Time> {
  private gaps: Gap[] = [];
  private showFilled = true;
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;

  setGaps(gaps: Gap[], showFilled: boolean) {
    this.gaps = gaps;
    this.showFilled = showFilled;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const zones: IPrimitivePaneRenderer = { draw: (t: CanvasRenderingTarget2D) => this.draw(t, false) };
    const labels: IPrimitivePaneRenderer = { draw: (t: CanvasRenderingTarget2D) => this.draw(t, true) };
    return [
      { zOrder: () => 'bottom', renderer: () => zones },
      { zOrder: () => 'top', renderer: () => labels },
    ];
  }

  private draw(target: CanvasRenderingTarget2D, labelsPass: boolean) {
    const chart = this.chart, series = this.series;
    if (!chart || !series || !this.gaps.length) return;
    const ts = chart.timeScale();
    const half = ts.options().barSpacing / 2;

    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.font = `600 ${Math.round(10 * vr)}px sans-serif`;
      ctx.textBaseline = 'middle';
      // labels: open gaps first, then the biggest, and a label never covers one already drawn
      const order = labelsPass ? [...this.gaps].sort((a, b) => Number(a.filled) - Number(b.filled) || Math.abs(b.pct) - Math.abs(a.pct)) : this.gaps;
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const g of order) {
        if (g.filled && !this.showFilled) continue;
        const x1 = ts.timeToCoordinate((g.startTime / 1000) as Time);
        const x2 = g.endTime === null ? null : ts.timeToCoordinate((g.endTime / 1000) as Time);
        const yA = series.priceToCoordinate(g.prevClose);
        const yB = series.priceToCoordinate(g.open);
        if (x1 === null || yA === null || yB === null) continue;
        const left = Math.max(0, (x1 - half) * hr);
        const right = g.endTime === null ? bitmapSize.width : Math.min(bitmapSize.width, ((x2 ?? x1) + half) * hr);
        if (right <= left || right < 0 || left > bitmapSize.width) continue;
        const top = Math.min(yA, yB) * vr, bottom = Math.max(yA, yB) * vr;
        const rgb = g.filled ? MUTED : g.dir === 'up' ? UP : DOWN;

        if (!labelsPass) {
          ctx.fillStyle = `rgba(${rgb}, ${g.filled ? 0.1 : 0.2})`;
          ctx.fillRect(left, top, right - left, Math.max(1, bottom - top));
          ctx.strokeStyle = `rgba(${rgb}, ${g.filled ? 0.5 : 0.9})`;
          ctx.lineWidth = Math.max(1, hr);
          ctx.setLineDash(g.filled ? [3 * hr, 3 * hr] : []);
          // the previous close is the line price has to come back to
          const yClose = (g.prevClose === Math.min(g.prevClose, g.open) ? bottom : top);
          ctx.beginPath();
          ctx.moveTo(left, yClose);
          ctx.lineTo(right, yClose);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const text = `GAP ${g.dir === 'up' ? '▲' : '▼'} ${g.pct >= 0 ? '+' : ''}${g.pct.toFixed(2)}%  ${g.filled ? 'filled' : `${Math.round(g.fillPct)}% filled`}`;
          const w = ctx.measureText(text).width + 10 * hr;
          const h = 15 * vr;
          const tall = bottom - top > h + 2 * vr;
          const y = tall ? top + h / 2 + 2 * vr : top - h / 2 - 2 * vr;
          let x = left + 4 * hr;
          if (x + w > bitmapSize.width) x = bitmapSize.width - w - 4 * hr;
          const box = { x, y: y - h / 2, w, h };
          if (placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
          placed.push(box);
          ctx.fillStyle = 'rgba(20, 25, 56, 0.88)';
          ctx.fillRect(x, y - h / 2, w, h);
          ctx.strokeStyle = `rgba(${rgb}, 0.8)`;
          ctx.lineWidth = Math.max(1, hr);
          ctx.strokeRect(x, y - h / 2, w, h);
          ctx.fillStyle = `rgb(${rgb})`;
          ctx.fillText(text, x + 5 * hr, y);
        }
      }
    });
  }
}

export const attachGapZones = (series: ISeriesApi<'Candlestick'>) => {
  const primitive = new GapZonesPrimitive();
  series.attachPrimitive(primitive);
  return primitive;
};
