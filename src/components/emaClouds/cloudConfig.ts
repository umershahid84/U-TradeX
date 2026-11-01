import { CLOUD_TFS, CloudTf, MaType, PriceSource } from '../../utils/htfEma';

export type CloudKey = 'ripster' | 'mtf';

export interface Cloud {
  /** Show this cloud */
  enabled: boolean;
  short: number;
  long: number;
  /** Timeframe whose candles the two averages are calculated on; 'chart' follows the chart */
  tf: CloudTf;
  /** Shade the area between the two averages */
  fill: boolean;
  /** Fill colour when the short average is at or above the long one, and when below */
  bull: string;
  bear: string;
  /** Opacity 0-100 (TradingView's transparency is 100 minus this) */
  bullOpacity: number;
  bearOpacity: number;
  /** Draw the two averages as lines */
  lines: boolean;
  /** Line colours when the average is rising or flat (up) and when falling (down) */
  shortUp: string;
  shortDown: string;
  shortWidth: 1 | 2 | 3 | 4;
  longUp: string;
  longDown: string;
  longWidth: 1 | 2 | 3 | 4;
}

export interface CloudVisibility {
  minutes: boolean;
  hours: boolean;
  days: boolean;
  weeks: boolean;
  months: boolean;
}

export interface CloudGroup {
  /** The whole indicator is on */
  enabled: boolean;
  /** Moving average type (Ripster EMA Clouds only; the MTF script is always EMA) */
  maType: MaType;
  source: PriceSource;
  /**
   * Bars to shift the plots (positive = right). This is "Leading Period For EMA Cloud" in the Ripster
   * EMA Clouds script (0 or more) and "Offset" in the Ripster MTF Clouds script.
   */
  offset: number;
  /** Chart timeframes the indicator is drawn on, like TradingView's Visibility tab */
  visibility: CloudVisibility;
  clouds: Cloud[];
}

export type CloudConfig = Record<CloudKey, CloudGroup>;

export const MAX_CLOUDS = 8;
const CONFIG_VERSION = 3;

export const CLOUD_TITLES: Record<CloudKey, string> = {
  ripster: 'Ripster EMA Clouds',
  mtf: 'Ripster MTF Clouds',
};

const allVisible: CloudVisibility = { minutes: true, hours: true, days: true, weeks: true, months: true };

// Colours from the Pine v4 palette used by the Ripster EMA Clouds script
const OLIVE = '#808000';
const MAROON = '#880E4F';
const GREEN = '#4CAF50';
const RED = '#FF5252';

// Ripster EMA Clouds: cloud colour is `bull` while short >= long, `bear` otherwise, with the
// script's own transparencies (45, 65, 70, 65, 65 -> opacity 55, 35, 30, 35, 35). Lines are drawn
// only when "Display EMA Line" is on: thin short lines (olive rising / maroon falling) and thick
// long lines (green rising / red falling).
const ripsterCloud = (
  short: number, long: number, bull: string, bear: string, opacity: number, enabled: boolean, shortUp = OLIVE
): Cloud => ({
  enabled, short, long, tf: 'chart', fill: true, bull, bear, bullOpacity: opacity, bearOpacity: opacity,
  lines: false, shortUp, shortDown: MAROON, shortWidth: 1, longUp: GREEN, longDown: RED, longWidth: 3,
});

// Ripster MTF Clouds: one flat colour per cloud at 85 transparency (15% opacity), with both lines
// always drawn in that colour, 1px wide
const mtfCloud = (short: number, long: number, color: string): Cloud => ({
  enabled: true, short, long, tf: '1d', fill: true, bull: color, bear: color, bullOpacity: 15, bearOpacity: 15,
  lines: true, shortUp: color, shortDown: color, shortWidth: 1, longUp: color, longDown: color, longWidth: 1,
});

export const DEFAULT_CLOUDS: CloudConfig = {
  ripster: {
    enabled: false,
    maType: 'EMA',
    source: 'hl2',
    offset: 0,
    visibility: { ...allVisible },
    clouds: [
      ripsterCloud(8, 9, '#036103', '#880e4f', 55, true),
      ripsterCloud(5, 12, '#4caf50', '#f44336', 35, true),
      ripsterCloud(34, 50, '#2196f3', '#ffb74d', 30, true),
      ripsterCloud(72, 89, '#009688', '#f06292', 35, false),
      ripsterCloud(180, 200, '#05bed5', '#e65100', 35, false, '#B3B32B'),
    ],
  },
  mtf: {
    enabled: false,
    maType: 'EMA',
    source: 'hl2',
    offset: 0,
    visibility: { ...allVisible },
    clouds: [mtfCloud(50, 55, '#2962FF'), mtfCloud(20, 21, '#089981')],
  },
};

export const cloneGroup = (g: CloudGroup): CloudGroup => JSON.parse(JSON.stringify(g));

/** Colours for clouds added beyond the script's own */
const EXTRA_COLORS = ['#FF9800', '#9C27B0', '#E040FB', '#FFEB3B', '#00BCD4', '#F23645'];

export const newCloud = (key: CloudKey, existing: Cloud[]): Cloud => {
  const last = existing[existing.length - 1];
  const color = EXTRA_COLORS[existing.length % EXTRA_COLORS.length];
  const short = last ? last.long + 1 : 20;
  const long = last ? last.long + 20 : 40;
  const base = key === 'mtf' ? mtfCloud(short, long, color) : ripsterCloud(short, long, color, color, 35, true);
  return { ...base, tf: last ? last.tf : base.tf };
};

export const hexToRgba = (hex: string, opacityPct: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(100, opacityPct)) / 100})`;
};

/** Which TradingView-style visibility class a chart interval (ms) falls in */
export const visibilityClass = (chartMs: number): keyof CloudVisibility => {
  const DAY = 24 * 60 * 60 * 1000;
  if (chartMs < 60 * 60 * 1000) return 'minutes';
  if (chartMs < DAY) return 'hours';
  if (chartMs < 7 * DAY) return 'days';
  if (chartMs < 28 * DAY) return 'weeks';
  return 'months';
};

export const isVisibleOn = (g: CloudGroup, chartMs: number): boolean =>
  !chartMs || g.visibility[visibilityClass(chartMs)];

const STORAGE_KEY = 'cloudConfig';

const validTf = (tf: unknown): CloudTf => (CLOUD_TFS.some((o) => o.value === tf) ? (tf as CloudTf) : 'chart');

// Bring any older saved format up to date. Saves from before the exact script settings keep what
// they can (which clouds are shown, their lengths and timeframes); colours and the Ripster MTF
// clouds go back to the scripts' own defaults.
const migrateGroup = (key: CloudKey, saved: any): CloudGroup => {
  const base = cloneGroup(DEFAULT_CLOUDS[key]);
  if (!saved) return base;

  if (saved.v === CONFIG_VERSION && Array.isArray(saved.clouds)) {
    return {
      ...base,
      ...saved,
      visibility: { ...base.visibility, ...(saved.visibility ?? {}) },
      clouds: saved.clouds.map((c: Cloud, i: number) => ({
        ...(base.clouds[i] ?? newCloud(key, base.clouds)),
        ...c,
        tf: validTf(c.tf),
      })),
    };
  }

  base.enabled = !!saved.enabled;
  if (key === 'ripster') {
    const old: any[] = Array.isArray(saved.clouds) ? saved.clouds : Array.isArray(saved.pairs) ? saved.pairs : [];
    const groupTf = validTf(saved.tf);
    old.forEach((o, i) => {
      const target = base.clouds[i] ?? (base.clouds[i] = newCloud(key, base.clouds));
      target.enabled = o.enabled !== false;
      target.short = o.short ?? o.fast ?? target.short;
      target.long = o.long ?? o.slow ?? target.long;
      target.tf = validTf(o.tf ?? groupTf);
      target.fill = typeof o.fill === 'boolean' ? o.fill : true;
      target.lines = typeof o.lines === 'boolean' ? o.lines : !!saved.showLines;
    });
    if (saved.maType === 'SMA') base.maType = 'SMA';
  }
  return base;
};

export const loadCloudConfig = (): CloudConfig => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return { ripster: migrateGroup('ripster', saved?.ripster), mtf: migrateGroup('mtf', saved?.mtf) };
  } catch {
    return { ripster: cloneGroup(DEFAULT_CLOUDS.ripster), mtf: cloneGroup(DEFAULT_CLOUDS.mtf) };
  }
};

export const saveCloudConfig = (c: CloudConfig) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ripster: { ...c.ripster, v: CONFIG_VERSION }, mtf: { ...c.mtf, v: CONFIG_VERSION } })
    );
  } catch {
    /* storage unavailable */
  }
};
