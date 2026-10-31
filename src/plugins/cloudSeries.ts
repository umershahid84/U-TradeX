// Custom lightweight-charts series that fills the area between two lines (an "EMA cloud").
import {
  customSeriesDefaultOptions,
  CustomSeriesOptions,
  CustomData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
  WhitespaceData,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface CloudData extends CustomData<Time> {
  /** First line value (the "fast" line for EMA clouds) */
  upper: number;
  /** Second line value (the "slow" line) */
  lower: number;
  /** Optional fill colour for this bar, overrides bull/bear colouring */
  color?: string;
}

export interface CloudOptions extends CustomSeriesOptions {
  /** Fill used where upper >= lower */
  bullColor: string;
  /** Fill used where upper < lower */
  bearColor: string;
}

export const cloudDefaultOptions: CloudOptions = {
  ...customSeriesDefaultOptions,
  bullColor: 'rgba(38, 166, 154, 0.25)',
  bearColor: 'rgba(239, 83, 80, 0.25)',
  priceLineVisible: false,
  lastValueVisible: false,
};

interface BarItem {
  x: number;
  upper: number;
  lower: number;
  color?: string;
}

class CloudRenderer implements ICustomSeriesPaneRenderer {
  private bars: BarItem[] = [];
  private options: CloudOptions | null = null;

  update(data: PaneRendererCustomData<Time, CloudData>, options: CloudOptions) {
    this.options = options;
    const { from, to } = data.visibleRange ?? { from: 0, to: -1 };
    // include one extra bar either side so the fill reaches the screen edges
    const start = Math.max(0, from - 1);
    const end = Math.min(data.bars.length - 1, to + 1);
    this.bars = [];
    for (let i = start; i <= end; i++) {
      const b = data.bars[i];
      this.bars.push({
        x: b.x,
        upper: b.originalData.upper,
        lower: b.originalData.lower,
        color: b.originalData.color,
      });
    }
  }

  draw(target: CanvasRenderingTarget2D, priceToCoordinate: PriceToCoordinateConverter) {
    const options = this.options;
    if (!options || this.bars.length < 2) return;

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const pts = this.bars.map((b) => ({
        x: b.x * hr,
        u: priceToCoordinate(b.upper),
        l: priceToCoordinate(b.lower),
        diff: b.upper - b.lower,
        color: b.color,
      }));

      const fill = (poly: [number, number][], color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.fill();
      };

      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a.u === null || a.l === null || b.u === null || b.l === null) continue;
        const au = a.u * vr, al = a.l * vr, bu = b.u * vr, bl = b.l * vr;
        const colorFor = (diff: number, custom?: string) =>
          custom ?? (diff >= 0 ? options.bullColor : options.bearColor);

        if (a.diff * b.diff >= 0) {
          fill([[a.x, au], [b.x, bu], [b.x, bl], [a.x, al]], colorFor(a.diff || b.diff, a.color));
        } else {
          // lines cross between the two bars: split the fill at the crossing point
          const t = a.diff / (a.diff - b.diff);
          const cx = a.x + (b.x - a.x) * t;
          const cy = au + (bu - au) * t;
          fill([[a.x, au], [cx, cy], [a.x, al]], colorFor(a.diff, a.color));
          fill([[cx, cy], [b.x, bu], [b.x, bl]], colorFor(b.diff, b.color));
        }
      }
    });
  }
}

export class CloudSeries implements ICustomSeriesPaneView<Time, CloudData, CloudOptions> {
  private _renderer = new CloudRenderer();

  renderer() {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, CloudData>, options: CloudOptions) {
    this._renderer.update(data, options);
  }

  priceValueBuilder(plotRow: CloudData): number[] {
    return [plotRow.upper, plotRow.lower, plotRow.upper];
  }

  isWhitespace(data: CloudData | WhitespaceData<Time>): data is WhitespaceData<Time> {
    return (data as CloudData).upper === undefined || (data as CloudData).lower === undefined;
  }

  defaultOptions() {
    return cloudDefaultOptions;
  }
}
