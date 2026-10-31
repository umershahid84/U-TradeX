// Chart primitive that shades pre-market / after-hours / overnight sessions behind the candles
// and marks the gaps where no overnight bars exist.
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
import { SESSION_COLOR, SessionBand, SessionGap, Session } from '../utils/marketSessions';

const FILL: Record<Session, string | null> = {
  pre: 'rgba(66, 165, 245, 0.13)',
  regular: null,
  post: 'rgba(255, 167, 38, 0.13)',
  overnight: 'rgba(149, 117, 205, 0.16)',
  closed: null,
};

const TAG: Record<Session, string> = {
  pre: 'PRE-MARKET',
  regular: '',
  post: 'AFTER HOURS',
  overnight: 'OVERNIGHT',
  closed: '',
};

export class SessionBandsPrimitive implements ISeriesPrimitive<Time> {
  private bands: SessionBand[] = [];
  private gaps: SessionGap[] = [];
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;

  setLayout(bands: SessionBand[], gaps: SessionGap[]) {
    this.bands = bands;
    this.gaps = gaps;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: CanvasRenderingTarget2D) => this.draw(target),
    };
    return [{ zOrder: () => 'bottom', renderer: () => renderer }];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const chart = this.chart;
    if (!chart || (this.bands.length === 0 && this.gaps.length === 0)) return;
    const ts = chart.timeScale();
    const x = (ms: number) => ts.timeToCoordinate((ms / 1000) as Time);
    const half = ts.options().barSpacing / 2;

    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.font = `${Math.round(10 * vr)}px sans-serif`;
      ctx.textBaseline = 'top';

      for (const band of this.bands) {
        const fill = FILL[band.session];
        if (!fill) continue;
        const x1 = x(band.start), x2 = x(band.end);
        if (x1 === null || x2 === null) continue;
        const left = (x1 - half) * hr, right = (x2 + half) * hr;
        if (right < 0 || left > bitmapSize.width) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(left, 0, right - left, bitmapSize.height);

        if (right - left > 70 * hr) {
          ctx.fillStyle = SESSION_COLOR[band.session];
          ctx.globalAlpha = 0.85;
          ctx.fillText(TAG[band.session], Math.max(left + 6 * hr, 60 * hr), bitmapSize.height - 18 * vr);
          ctx.globalAlpha = 1;
        }
      }

      for (const gap of this.gaps) {
        const x1 = x(gap.from), x2 = x(gap.to);
        if (x1 === null || x2 === null) continue;
        const gx = ((x1 + x2) / 2) * hr;
        if (gx < 0 || gx > bitmapSize.width) continue;
        const color = gap.kind === 'overnight' ? SESSION_COLOR.overnight : SESSION_COLOR.closed;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4 * hr, 4 * hr]);
        ctx.lineWidth = hr;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, bitmapSize.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.textAlign = 'center';
        ctx.fillText(gap.kind === 'overnight' ? '🌙 OVERNIGHT · no data' : 'CLOSED', gx, bitmapSize.height - 18 * vr);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    });
  }
}

export const attachSessionBands = (series: ISeriesApi<'Candlestick'>) => {
  const primitive = new SessionBandsPrimitive();
  series.attachPrimitive(primitive);
  return primitive;
};
