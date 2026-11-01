// Draws the stage labels (EARLY, ENTRY, CAUTION, TAKE PROFIT, EXIT) as rounded boxes next to the bars
import type {
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface AlphaLabelItem {
  /** Bar time in ms */
  time: number;
  /** Price the label hangs from (the bar's low or high) */
  price: number;
  text: string;
  background: string;
  /** Box sits above the price (true) or below it */
  above: boolean;
}

export class AlphaLabelsPrimitive implements ISeriesPrimitive<Time> {
  private items: AlphaLabelItem[] = [];
  private chart: SeriesAttachedParameter<Time>['chart'] | null = null;
  private series: ISeriesApi<any> | null = null;
  private requestUpdate: (() => void) | null = null;

  setItems(items: AlphaLabelItem[]) {
    this.items = items;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = { draw: (target: CanvasRenderingTarget2D) => this.draw(target) };
    return [{ zOrder: () => 'top', renderer: () => renderer }];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const chart = this.chart, series = this.series;
    if (!chart || !series || this.items.length === 0) return;
    const ts = chart.timeScale();

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      ctx.font = `700 ${Math.round(11 * vr)}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      for (const it of this.items) {
        const x = ts.timeToCoordinate((it.time / 1000) as Time);
        const y = series.priceToCoordinate(it.price);
        if (x === null || y === null) continue;
        const cx = (x as number) * hr;
        const padX = 7 * hr, h = 18 * vr, gap = 10 * vr;
        const w = ctx.measureText(it.text).width + padX * 2;
        if (cx + w / 2 < 0 || cx - w / 2 > bitmapSize.width) continue;

        const top = it.above ? (y as number) * vr - gap - h : (y as number) * vr + gap;
        ctx.fillStyle = it.background;
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, top, w, h, 4 * vr);
        ctx.fill();
        // small pointer toward the bar
        ctx.beginPath();
        const tipY = it.above ? top + h : top;
        const dir = it.above ? 1 : -1;
        ctx.moveTo(cx - 4 * hr, tipY);
        ctx.lineTo(cx + 4 * hr, tipY);
        ctx.lineTo(cx, tipY + dir * 5 * vr);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(it.text, cx, top + h / 2);
      }
    });
  }
}
