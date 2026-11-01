import { ChartData } from '../types';

export type ChartType = 'candles' | 'hollow' | 'bars' | 'heikin' | 'line' | 'area';
export type ChartTheme = 'dark' | 'light';

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'candles', label: 'Candles' },
  { value: 'hollow', label: 'Hollow candles' },
  { value: 'bars', label: 'Bars' },
  { value: 'heikin', label: 'Heikin Ashi' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
];

export interface ThemeColors {
  bg: string;
  text: string;
  grid: string;
  border: string;
  /** Line and area colour for the line chart types */
  line: string;
}

export const THEME_COLORS: Record<ChartTheme, ThemeColors> = {
  dark: { bg: '#0a0e27', text: '#e0e0e0', grid: '#1a1e3f', border: '#2a2e4f', line: '#5C8DFF' },
  light: { bg: '#ffffff', text: '#131722', grid: '#eceff4', border: '#d1d4dc', line: '#2962FF' },
};

export const UP_COLOR = '#26a69a';
export const DOWN_COLOR = '#ef5350';

export interface ChartStyleSettings {
  type: ChartType;
  theme: ChartTheme;
}

const KEY = 'chartStyle';

export const loadChartStyle = (): ChartStyleSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return {
      type: CHART_TYPES.some((t) => t.value === saved?.type) ? saved.type : 'candles',
      theme: saved?.theme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return { type: 'candles', theme: 'dark' };
  }
};

export const saveChartStyle = (s: ChartStyleSettings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
};

/** Heikin Ashi bars: smoothed candles built from the averages of the real ones */
export const toHeikinAshi = (data: ChartData[]): ChartData[] => {
  const out: ChartData[] = [];
  data.forEach((d, i) => {
    const close = (d.open + d.high + d.low + d.close) / 4;
    const open = i === 0 ? (d.open + d.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: d.time,
      open,
      close,
      high: Math.max(d.high, open, close),
      low: Math.min(d.low, open, close),
      volume: d.volume,
    });
  });
  return out;
};
