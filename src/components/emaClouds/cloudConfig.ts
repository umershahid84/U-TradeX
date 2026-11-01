import { CLOUD_TFS, CloudTf, MaType, PriceSource } from '../../utils/htfEma';

export type CloudKey = 'ripster' | 'mtf';

export interface Cloud {
  /** Show this cloud */
  enabled: boolean;
  short: number;
  long: number;
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
   * Timeframe whose candles the averages are calculated on. Ripster MTF Clouds has this as its
   * "Resolution" input (default Daily); Ripster EMA Clouds always uses the chart's own candles.
   */
  resolution: CloudTf;
  /**
   * Bars to shift the plots (positive = right). This is "Leading Period For EMA Cloud" in the Ripster
   * EMA Clouds script (0 or more) and "Offset" in the Ripster MTF Clouds script.
   */
  offset: number;
  /** Chart timeframes the indicator is drawn on, like TradingView's Visibility tab */
  visibility: CloudVisibility;
  clouds: Cloud[];
}

/** One copy of an indicator on the chart; like TradingView, the same one can be added many times */
export interface CloudInstance extends CloudGroup {
  id: string;
  kind: CloudKey;
}

const CONFIG_VERSION = 4;

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
  enabled, short, long, fill: true, bull, bear, bullOpacity: opacity, bearOpacity: opacity,
  lines: false, shortUp, shortDown: MAROON, shortWidth: 1, longUp: GREEN, longDown: RED, longWidth: 3,
});

// Ripster MTF Clouds: one flat colour per cloud at 85 transparency (15% opacity), with both lines
// always drawn in that colour, 1px wide
const mtfCloud = (short: number, long: number, color: string): Cloud => ({
  enabled: true, short, long, fill: true, bull: color, bear: color, bullOpacity: 15, bearOpacity: 15,
  lines: true, shortUp: color, shortDown: color, shortWidth: 1, longUp: color, longDown: color, longWidth: 1,
});

const RIPSTER_DEFAULTS: CloudGroup = {
  enabled: true,
  maType: 'EMA',
  source: 'hl2',
  resolution: 'chart',
  offset: 0,
  visibility: { ...allVisible },
  clouds: [
    ripsterCloud(8, 9, '#036103', '#880e4f', 55, true),
    ripsterCloud(5, 12, '#4caf50', '#f44336', 35, true),
    ripsterCloud(34, 50, '#2196f3', '#ffb74d', 30, true),
    ripsterCloud(72, 89, '#009688', '#f06292', 35, false),
    ripsterCloud(180, 200, '#05bed5', '#e65100', 35, false, '#B3B32B'),
  ],
};

const MTF_DEFAULTS: CloudGroup = {
  enabled: true,
  maType: 'EMA',
  source: 'hl2',
  resolution: '1d',
  offset: 0,
  visibility: { ...allVisible },
  clouds: [mtfCloud(50, 55, '#2962FF'), mtfCloud(20, 21, '#089981')],
};

export const DEFAULT_CLOUDS: Record<CloudKey, CloudGroup> = { ripster: RIPSTER_DEFAULTS, mtf: MTF_DEFAULTS };

export const cloneGroup = (g: CloudGroup): CloudGroup => JSON.parse(JSON.stringify(g));

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

const STORAGE_KEY = 'cloudInstances';
const OLD_STORAGE_KEY = 'cloudConfig';

const validTf = (tf: unknown): CloudTf => (CLOUD_TFS.some((o) => o.value === tf) ? (tf as CloudTf) : 'chart');

let idCounter = 0;
const makeId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A fresh copy of an indicator with the script's own defaults */
export const newInstance = (kind: CloudKey): CloudInstance => ({ ...cloneGroup(DEFAULT_CLOUDS[kind]), id: makeId(), kind });

export const instanceTitle = (i: CloudInstance): string => CLOUD_TITLES[i.kind];

/** Timeframe an instance reads its candles from */
export const instanceTf = (i: CloudInstance): CloudTf => (i.kind === 'mtf' ? i.resolution : 'chart');

const cleanInstance = (saved: any): CloudInstance | null => {
  if (!saved || (saved.kind !== 'ripster' && saved.kind !== 'mtf')) return null;
  const base = newInstance(saved.kind);
  return {
    ...base,
    ...saved,
    id: typeof saved.id === 'string' ? saved.id : base.id,
    resolution: saved.kind === 'mtf' ? validTf(saved.resolution) : 'chart',
    visibility: { ...base.visibility, ...(saved.visibility ?? {}) },
    clouds: base.clouds.map((c, i) => ({ ...c, ...(saved.clouds?.[i] ?? {}) })),
  };
};

// Earlier versions kept one fixed Ripster and one MTF indicator. Bring over the ones that were on.
const migrateOld = (saved: any): CloudInstance[] => {
  const out: CloudInstance[] = [];
  if (saved?.ripster?.enabled) {
    const inst = newInstance('ripster');
    const old: any[] = Array.isArray(saved.ripster.clouds) ? saved.ripster.clouds : Array.isArray(saved.ripster.pairs) ? saved.ripster.pairs : [];
    old.slice(0, inst.clouds.length).forEach((o, i) => {
      const c = inst.clouds[i];
      c.enabled = o.enabled !== false;
      c.short = o.short ?? o.fast ?? c.short;
      c.long = o.long ?? o.slow ?? c.long;
      c.fill = typeof o.fill === 'boolean' ? o.fill : true;
      c.lines = typeof o.lines === 'boolean' ? o.lines : !!saved.ripster.showLines;
    });
    if (saved.ripster.maType === 'SMA') inst.maType = 'SMA';
    out.push(inst);
  }
  if (saved?.mtf?.enabled) {
    const inst = newInstance('mtf');
    const first = (saved.mtf.clouds ?? saved.mtf.pairs ?? [])[0];
    const tf = validTf(first?.tf ?? saved.mtf.tf);
    if (tf !== 'chart') inst.resolution = tf;
    out.push(inst);
  }
  return out;
};

export const loadCloudInstances = (): CloudInstance[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.map(cleanInstance).filter((i): i is CloudInstance => !!i) : [];
    }
    return migrateOld(JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) ?? 'null'));
  } catch {
    return [];
  }
};

export const saveCloudInstances = (list: CloudInstance[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map((i) => ({ ...i, v: CONFIG_VERSION }))));
  } catch {
    /* storage unavailable */
  }
};
