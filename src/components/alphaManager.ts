import { IChartApi, ISeriesApi, LineSeries, Time } from 'lightweight-charts';
import { ChartData } from '../types';
import { AlphaLabelsPrimitive } from '../plugins/alphaLabels';
import { AlphaResult, AlphaStage, LineState } from '../utils/alphaSignals';

export const ALPHA_COLORS: Record<LineState, string> = {
  bull: '#1FD37A',
  caution: '#FF9800',
  profit: '#FFD600',
  bear: '#EF5350',
  neutral: '#8A8FB5',
};

const STAGE_COLOR: Record<AlphaStage, { long: string; short: string }> = {
  EARLY: { long: '#1FD37A', short: '#E5484D' },
  ENTRY: { long: '#1FD37A', short: '#E5484D' },
  CAUTION: { long: '#FF9800', short: '#FF9800' },
  'TAKE PROFIT': { long: '#F5A623', short: '#F5A623' },
  EXIT: { long: '#E5484D', short: '#E5484D' },
};

/** Draws the Alpha Signals trend lines and stage labels on the chart */
export class AlphaManager {
  private fastLine: ISeriesApi<'Line'> | null = null;
  private slowLine: ISeriesApi<'Line'> | null = null;
  private labels = new AlphaLabelsPrimitive();
  private sig = '';

  constructor(private chart: IChartApi, private candles: ISeriesApi<'Candlestick'>) {
    candles.attachPrimitive(this.labels);
  }

  private clear() {
    [this.fastLine, this.slowLine].forEach((s) => {
      if (s) { try { this.chart.removeSeries(s); } catch { /* already removed */ } }
    });
    this.fastLine = null;
    this.slowLine = null;
    this.labels.setItems([]);
  }

  update(result: AlphaResult | null, data: ChartData[], show: { enabled: boolean; labels: boolean }) {
    if (!show.enabled || !result || !data.length) {
      if (this.sig) this.clear();
      this.sig = '';
      return;
    }

    if (!this.fastLine) {
      this.slowLine = this.chart.addSeries(LineSeries, {
        color: 'rgba(180, 184, 205, 0.55)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      this.fastLine = this.chart.addSeries(LineSeries, {
        color: ALPHA_COLORS.bull, lineWidth: 3, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }

    this.slowLine!.setData(result.slow.map((v, i) => ({ time: (data[i].time / 1000) as Time, value: v })));
    this.fastLine.setData(
      result.fast.map((v, i) => ({ time: (data[i].time / 1000) as Time, value: v, color: ALPHA_COLORS[result.state[i] ?? 'neutral'] }))
    );

    const items = show.labels
      ? result.labels.map((l) => {
          const bar = data[l.idx];
          // long setups hang below the bar (early/entry) or above it (caution/profit); mirrored for shorts
          const bullishStage = l.stage === 'EARLY' || l.stage === 'ENTRY';
          const above = l.side === 'long' ? !bullishStage : bullishStage;
          return {
            time: bar.time,
            price: above ? bar.high : bar.low,
            text: l.stage,
            background: STAGE_COLOR[l.stage][l.side],
            above,
          };
        })
      : [];
    const sig = `${data.length}|${items.length}|${items[items.length - 1]?.time}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.labels.setItems(items);
    }
  }

  destroy() {
    this.clear();
    this.candles.detachPrimitive(this.labels);
  }
}
