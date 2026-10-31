import {
  createSeriesMarkers,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineSeries,
  LineType,
  SeriesMarker,
  Time,
} from 'lightweight-charts';
import { ChartData, CustomIndicator, CustomIndicatorStatus } from '../types';
import { PineError, PineMarker, PineResult, runPine } from '../pine';
import { CloudData, CloudSeries } from '../plugins/cloudSeries';

type SeriesSpec =
  | { kind: 'line'; options: Record<string, unknown>; data: any[] }
  | { kind: 'hist'; options: Record<string, unknown>; data: any[] }
  | { kind: 'cloud'; options: Record<string, unknown>; data: CloudData[] };

interface Spec {
  overlay: boolean;
  series: SeriesSpec[];
  hlines: { price: number; color: string; title: string }[];
  markers: PineMarker[];
}

interface Entry {
  sig: string;
  series: ISeriesApi<any>[];
  priceLines: { series: ISeriesApi<any>; line: IPriceLine }[];
  markerPlugin?: ISeriesMarkersPluginApi<Time>;
}

const toTime = (ms: number) => (ms / 1000) as Time;

/**
 * Renders user-defined (Pine Script / JavaScript) indicators on a chart. It owns its own
 * series, so toggling the built-in indicators never removes them.
 */
export class CustomIndicatorManager {
  private entries = new Map<string, Entry>();
  private candleMarkers: ISeriesMarkersPluginApi<Time>;

  constructor(private chart: IChartApi, candles: ISeriesApi<'Candlestick'>) {
    this.candleMarkers = createSeriesMarkers(candles, []);
  }

  sync(indicators: CustomIndicator[], data: ChartData[]): Record<string, CustomIndicatorStatus> {
    const statuses: Record<string, CustomIndicatorStatus> = {};
    const enabled = indicators.filter((i) => i.enabled);
    const wanted = new Set(enabled.map((i) => i.id));
    [...this.entries.keys()].forEach((id) => { if (!wanted.has(id)) this.destroy(id); });

    const candleMarkers: PineMarker[] = [];

    for (const ind of indicators) {
      if (!ind.enabled) {
        statuses[ind.id] = { warnings: [], inputs: [] };
        continue;
      }
      const status: CustomIndicatorStatus = { warnings: [], inputs: [] };
      statuses[ind.id] = status;

      let spec: Spec;
      try {
        spec = this.build(ind, data, status);
      } catch (e) {
        status.error = e instanceof Error ? e.message : String(e);
        if (e instanceof PineError) status.errorLine = e.line;
        this.destroy(ind.id);
        continue;
      }

      const sig = JSON.stringify([spec.overlay, spec.series.map((s) => [s.kind, s.options])]);
      let entry = this.entries.get(ind.id);
      if (!entry || entry.sig !== sig) {
        this.destroy(ind.id);
        entry = this.create(ind.id, sig, spec);
      }

      spec.series.forEach((s, k) => entry!.series[k].setData(s.data));

      // horizontal levels
      entry.priceLines.forEach(({ series, line }) => series.removePriceLine(line));
      entry.priceLines = [];
      const host = entry.series.find((_s, k) => spec.series[k].kind !== 'cloud');
      if (host) {
        spec.hlines.forEach((h) => {
          entry!.priceLines.push({
            series: host,
            line: host.createPriceLine({ price: h.price, color: h.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: h.title }),
          });
        });
      }

      // markers (plotshape / plotchar)
      if (spec.overlay) {
        candleMarkers.push(...spec.markers);
      } else if (host) {
        if (!entry.markerPlugin) entry.markerPlugin = createSeriesMarkers(host, []);
        entry.markerPlugin.setMarkers(this.toMarkers(spec.markers));
      }
    }

    this.candleMarkers.setMarkers(this.toMarkers(candleMarkers));
    this.pruneEmptyPanes();
    return statuses;
  }

  private toMarkers(list: PineMarker[]): SeriesMarker<Time>[] {
    return list
      .map((m) => ({ time: toTime(m.time), position: m.position, shape: m.shape, color: m.color, text: m.text }))
      .sort((a, b) => (a.time as number) - (b.time as number));
  }

  private create(id: string, sig: string, spec: Spec): Entry {
    const paneIndex = spec.overlay ? 0 : this.chart.panes().length;
    const series = spec.series.map((s) => {
      if (s.kind === 'cloud') {
        return this.chart.addCustomSeries(new CloudSeries(), s.options as any, paneIndex);
      }
      const type = s.kind === 'hist' ? HistogramSeries : LineSeries;
      return this.chart.addSeries(type as any, s.options as any, paneIndex);
    });
    if (!spec.overlay) {
      const panes = this.chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(3);
        panes[paneIndex]?.setStretchFactor(1);
      }
    }
    const entry: Entry = { sig, series, priceLines: [] };
    this.entries.set(id, entry);
    return entry;
  }

  private destroy(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.markerPlugin?.detach();
    entry.series.forEach((s) => { try { this.chart.removeSeries(s); } catch { /* already removed */ } });
    this.entries.delete(id);
  }

  private pruneEmptyPanes() {
    const panes = this.chart.panes();
    for (let i = panes.length - 1; i > 0; i--) {
      if (panes[i].getSeries().length === 0) this.chart.removePane(i);
    }
  }

  // ---- building series specs ----
  private build(ind: CustomIndicator, data: ChartData[], status: CustomIndicatorStatus): Spec {
    return ind.language === 'js' ? this.buildJs(ind, data) : this.buildPine(ind, data, status);
  }

  private buildJs(ind: CustomIndicator, data: ChartData[]): Spec {
    const prices = data.map((d) => d.close);
    // eslint-disable-next-line no-new-func
    const fn = new Function('prices', 'close', 'open', 'high', 'low', 'volume', `return ${ind.source}`);
    const values = fn(
      prices, prices, data.map((d) => d.open), data.map((d) => d.high), data.map((d) => d.low), data.map((d) => d.volume)
    );
    if (!Array.isArray(values) || values.length !== data.length) {
      throw new Error('The formula must return an array with one value per bar');
    }
    const width = Math.max(1, Math.min(4, Math.round(ind.lineWidth)));
    return {
      overlay: true,
      hlines: [],
      markers: [],
      series: [{
        kind: 'line',
        options: { color: ind.color, lineWidth: width, title: ind.name, priceLineVisible: false },
        data: values.map((v: unknown, i: number) =>
          typeof v === 'number' && Number.isFinite(v) ? { time: toTime(data[i].time), value: v } : { time: toTime(data[i].time) }),
      }],
    };
  }

  private buildPine(ind: CustomIndicator, data: ChartData[], status: CustomIndicatorStatus): Spec {
    const result: PineResult = runPine(ind.source, data, ind.inputValues ?? {});
    status.warnings = result.warnings;
    status.inputs = result.inputs;
    if (result.plots.length === 0 && result.fills.length === 0 && result.markers.length === 0 && result.hlines.length === 0) {
      status.warnings = [...status.warnings, 'The script does not plot anything. Use plot(), fill(), hline() or plotshape().'];
    }

    const series: SeriesSpec[] = [];
    const valuesOf = (ref: number | { hline: number }): (number | null)[] => {
      if (typeof ref === 'number') return result.plots.find((p) => p.id === ref)?.values ?? [];
      return data.map(() => ref.hline);
    };

    // fills first so they sit underneath the lines
    result.fills.forEach((f) => {
      const a = valuesOf(f.a), b = valuesOf(f.b);
      const cloud: CloudData[] = [];
      data.forEach((d, i) => {
        const u = a[i], l = b[i];
        if (u == null || l == null) cloud.push({ time: toTime(d.time) } as any);
        else cloud.push({ time: toTime(d.time), upper: u, lower: l, color: f.colors[i] ?? f.color });
      });
      series.push({ kind: 'cloud', options: { bullColor: f.color, bearColor: f.color }, data: cloud });
    });

    result.plots.forEach((p) => {
      const points = data.map((d, i) => {
        const v = p.values[i];
        if (v == null) return { time: toTime(d.time) };
        const c = p.colors[i];
        return c && c !== p.color ? { time: toTime(d.time), value: v, color: c } : { time: toTime(d.time), value: v };
      });
      if (p.style === 'histogram') {
        series.push({ kind: 'hist', options: { color: p.color, title: p.title, priceLineVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, data: points });
      } else {
        const dotted = p.style === 'circles' || p.style === 'cross';
        series.push({
          kind: 'line',
          options: {
            color: p.color, lineWidth: p.lineWidth, title: p.title, priceLineVisible: false,
            lineType: p.style === 'step' ? LineType.WithSteps : LineType.Simple,
            lineVisible: !dotted, pointMarkersVisible: dotted,
          },
          data: points,
        });
      }
    });

    return { overlay: result.overlay, series, hlines: result.hlines, markers: result.markers };
  }
}
