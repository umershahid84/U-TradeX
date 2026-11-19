import {
  createSeriesMarkers,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  SeriesMarker,
  Time,
} from 'lightweight-charts';
import { ChartData } from '../types';
import { AutoChartResult } from '../utils/autoChart';

export interface AutoChartOptions {
  enabled: boolean;
  levels: boolean;
  trendlines: boolean;
  patterns: boolean;
}

const GREEN = '#26a69a';
const RED = '#ef5350';
const GOLD = '#FFB300';

/** Draws the auto-chart analysis (levels, trendlines, double top/bottom) as chart series */
export class AutoChartManager {
  private series: ISeriesApi<'Line'>[] = [];
  private markers: ISeriesMarkersPluginApi<Time>;
  private sig = '';

  constructor(private chart: IChartApi, candles: ISeriesApi<'Candlestick'>) {
    this.markers = createSeriesMarkers(candles, []);
  }

  private clear() {
    this.series.forEach((s) => {
      try { this.chart.removeSeries(s); } catch { /* already removed */ }
    });
    this.series = [];
    this.markers.setMarkers([]);
  }

  private line(
    points: { time: number; value: number }[],
    color: string,
    style: LineStyle,
    width: 1 | 2 | 3,
    title: string
  ) {
    // the chart library needs strictly increasing times: a line that starts on the last candle would have two
    // points on the same time, so keep one per time, and draw nothing for a line that ends up with fewer than two
    const pts: { time: number; value: number }[] = [];
    for (const p of [...points].sort((a, b) => a.time - b.time)) {
      if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
      if (pts.length && pts[pts.length - 1].time === p.time) pts[pts.length - 1] = p;
      else pts.push(p);
    }
    if (pts.length < 2) return;
    const s = this.chart.addSeries(LineSeries, {
      color,
      lineWidth: width,
      lineStyle: style,
      title,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    try {
      s.setData(pts.map((p) => ({ time: (p.time / 1000) as Time, value: p.value })));
      this.series.push(s);
    } catch {
      // one bad line must not take the whole chart down
      try {
        this.chart.removeSeries(s);
      } catch {
        /* already removed */
      }
    }
  }

  update(result: AutoChartResult | null, data: ChartData[], opts: AutoChartOptions) {
    if (!opts.enabled || !result || data.length === 0) {
      if (this.sig !== '') this.clear();
      this.sig = '';
      return;
    }

    const lastIdx = data.length - 1;
    const t = (idx: number) => data[Math.max(0, Math.min(lastIdx, idx))].time;

    // redraw only when something visible changed, not on every price tick
    const sig = JSON.stringify([
      opts,
      data[lastIdx].time,
      result.levels.map((l) => [l.price.toFixed(3), l.fromIdx]),
      result.trendlines.map((l) => [l.a.idx, l.a.price.toFixed(3), l.b.idx, l.b.price.toFixed(3)]),
      result.pattern && [result.pattern.type, result.pattern.status, result.pattern.first.idx, result.pattern.second.idx, result.pattern.neckline.toFixed(3)],
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.clear();

    if (opts.levels) {
      result.levels.forEach((l) => {
        const color = l.kind === 'support' ? GREEN : RED;
        this.line(
          [{ time: t(Math.min(l.fromIdx, lastIdx - 1)), value: l.price }, { time: t(lastIdx), value: l.price }],
          color, LineStyle.Dashed, 1, `${l.kind === 'support' ? 'S' : 'R'} ×${l.touches}`
        );
      });
    }

    if (opts.trendlines) {
      result.trendlines.forEach((tl) => {
        const slope = (tl.b.price - tl.a.price) / (tl.b.idx - tl.a.idx);
        const endPrice = tl.b.price + slope * (lastIdx - tl.b.idx);
        if (!Number.isFinite(endPrice) || endPrice <= 0) return;
        this.line(
          [{ time: t(tl.a.idx), value: tl.a.price }, { time: t(lastIdx), value: endPrice }],
          tl.kind === 'support' ? GREEN : RED, LineStyle.Solid, 2, tl.kind === 'support' ? 'Support trend' : 'Resistance trend'
        );
      });
    }

    if (opts.patterns && result.pattern) {
      const p = result.pattern;
      const top = p.type === 'double_top';
      this.line(
        [{ time: t(Math.min(p.first.idx, lastIdx - 1)), value: p.neckline }, { time: t(lastIdx), value: p.neckline }],
        GOLD, LineStyle.Dashed, 2, 'Neckline'
      );
      this.line(
        [{ time: t(Math.min(p.second.idx, lastIdx - 1)), value: p.target }, { time: t(lastIdx), value: p.target }],
        GOLD, LineStyle.Dotted, 1, 'Target'
      );
      const label = top ? 'Top' : 'Bottom';
      const markers: SeriesMarker<Time>[] = [
        { time: (t(p.first.idx) / 1000) as Time, position: top ? 'aboveBar' : 'belowBar', shape: top ? 'arrowDown' : 'arrowUp', color: GOLD, text: `${label} 1` },
        { time: (t(p.second.idx) / 1000) as Time, position: top ? 'aboveBar' : 'belowBar', shape: top ? 'arrowDown' : 'arrowUp', color: GOLD, text: `${label} 2` },
      ];
      this.markers.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)));
    }
  }

  destroy() {
    this.clear();
    this.markers.detach();
  }
}
