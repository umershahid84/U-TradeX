// Chart primitive that shades the space between two prices, from an optional start time to the right edge, with a label
import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface Band {
  from: number;
  to: number;
  label: string;
  rgb?: string;
  /** Start of the box in chart time (seconds); the whole width when left out */
  fromTime?: number;
}

export class PriceBandPrimitive implements ISeriesPrimitive<Time> {
  private band: (Band & { rgb: string }) | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;

  setBand(band: Band | null) {
    this.band = band ? { rgb: '255, 202, 40', ...band } : null;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = { draw: (t: CanvasRenderingTarget2D) => this.draw(t) };
    return [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const series = this.series, band = this.band, chart = this.chart;
    if (!series || !band || !chart) return;
    const y1 = series.priceToCoordinate(band.from), y2 = series.priceToCoordinate(band.to);
    if (y1 === null || y2 === null) return;
    let x1: number | null = 0;
    if (band.fromTime !== undefined) x1 = chart.timeScale().timeToCoordinate(band.fromTime as Time);
    if (x1 === null) return;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const top = Math.min(y1, y2) * vr, bottom = Math.max(y1, y2) * vr;
      const left = Math.max(0, (x1 as number) * hr), w = bitmapSize.width - left;
      if (w <= 0) return;
      ctx.fillStyle = `rgba(${band.rgb}, 0.14)`;
      ctx.fillRect(left, top, w, bottom - top);
      ctx.strokeStyle = `rgba(${band.rgb}, 0.7)`;
      ctx.lineWidth = Math.max(1, hr);
      ctx.setLineDash([4 * hr, 4 * hr]);
      ctx.strokeRect(left, top, w, Math.max(1, bottom - top));
      ctx.setLineDash([]);
      ctx.font = `700 ${Math.round(10 * vr)}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgb(${band.rgb})`;
      ctx.fillText(band.label, left + 10 * hr, Math.min(bottom - 8 * vr, Math.max(top + 8 * vr, (top + bottom) / 2)));
    });
  }
}
