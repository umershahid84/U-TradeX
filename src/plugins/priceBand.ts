// Chart primitive that shades the space between two prices across the whole chart, with a label (used for the air gap)
import type { ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export class PriceBandPrimitive implements ISeriesPrimitive<Time> {
  private band: { from: number; to: number; label: string; rgb: string } | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;

  setBand(band: { from: number; to: number; label: string; rgb?: string } | null) {
    this.band = band ? { rgb: '255, 202, 40', ...band } : null;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = { draw: (t: CanvasRenderingTarget2D) => this.draw(t) };
    return [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const series = this.series, band = this.band;
    if (!series || !band) return;
    const y1 = series.priceToCoordinate(band.from), y2 = series.priceToCoordinate(band.to);
    if (y1 === null || y2 === null) return;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const top = Math.min(y1, y2) * vr, bottom = Math.max(y1, y2) * vr;
      ctx.fillStyle = `rgba(${band.rgb}, 0.12)`;
      ctx.fillRect(0, top, bitmapSize.width, Math.max(1, bottom - top));
      ctx.strokeStyle = `rgba(${band.rgb}, 0.55)`;
      ctx.lineWidth = Math.max(1, hr);
      ctx.setLineDash([4 * hr, 4 * hr]);
      ctx.strokeRect(0, top, bitmapSize.width, Math.max(1, bottom - top));
      ctx.setLineDash([]);
      ctx.font = `700 ${Math.round(10 * vr)}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgb(${band.rgb})`;
      ctx.fillText(band.label, 10 * hr, Math.min(bottom - 8 * vr, Math.max(top + 8 * vr, (top + bottom) / 2)));
    });
  }
}
