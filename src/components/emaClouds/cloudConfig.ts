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
  bull: string;
  bear: string;
  /** 0-100 */
  bullOpacity: number;
  bearOpacity: number;
  /** Draw the two averages as lines */
  lines: boolean;
  shortColor: string;
  longColor: string;
  lineWidth: 1 | 2 | 3 | 4;
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
  maType: MaType;
  source: PriceSource;
  /** Bars to shift the plots (positive = right) */
  offset: number;
  /** Chart timeframes the indicator is drawn on, like TradingView's Visibility tab */
  visibility: CloudVisibility;
  clouds: Cloud[];
}

export type CloudConfig = Record<CloudKey, CloudGroup>;

export const MAX_CLOUDS = 8;

export const CLOUD_TITLES: Record<CloudKey, string> = {
  ripster: 'Ripster EMA Clouds',
  mtf: 'MTF Clouds',
};

const cloud = (
  short: number,
  long: number,
  bull: string,
  bear: string,
  bullOpacity: number,
  bearOpacity: number,
  enabled = true
): Cloud => ({
  enabled, short, long, tf: 'chart', fill: true, bull, bear, bullOpacity, bearOpacity,
  lines: false, shortColor: bull, longColor: bear, lineWidth: 1,
});

// Ripster's five clouds: 8/9 and 5/12 are the short-term trend (bright green when bullish,
// orange when bearish), 34/50 the medium trend (drawn as a thin light band), 72/89 the long-term
// teal cloud, and 180/200 the very long-term cloud
export const DEFAULT_CLOUDS: CloudConfig = {
  ripster: {
    enabled: false,
    maType: 'EMA',
    source: 'close',
    offset: 0,
    visibility: { minutes: true, hours: true, days: true, weeks: true, months: true },
    clouds: [
      cloud(8, 9, '#00E676', '#FF9800', 80, 75),
      cloud(5, 12, '#00C853', '#FF6D00', 55, 55),
      cloud(34, 50, '#E0E0E0', '#E0E0E0', 60, 60),
      cloud(72, 89, '#00BCD4', '#0097A7', 65, 65),
      cloud(180, 200, '#7E57C2', '#AB47BC', 45, 45, false),
    ],
  },
  mtf: {
    enabled: false,
    maType: 'EMA',
    source: 'close',
    offset: 0,
    visibility: { minutes: true, hours: true, days: true, weeks: true, months: true },
    clouds: [
      cloud(34, 50, '#29B6F6', '#AB47BC', 40, 40),
      cloud(72, 89, '#5C6BC0', '#FF9800', 35, 35),
    ],
  },
};

export const cloneGroup = (g: CloudGroup): CloudGroup => JSON.parse(JSON.stringify(g));

/** Colours for clouds added beyond the defaults */
const EXTRA_COLORS = [
  ['#FFEE58', '#AB47BC'], ['#81C784', '#E57373'], ['#4DD0E1', '#FF8A65'], ['#7986CB', '#FFB74D'],
];

export const newCloud = (existing: Cloud[]): Cloud => {
  const last = existing[existing.length - 1];
  const [bull, bear] = EXTRA_COLORS[existing.length % EXTRA_COLORS.length];
  return {
    ...cloud(last ? last.long + 1 : 20, last ? last.long + 20 : 40, bull, bear, 40, 40),
    tf: last ? last.tf : 'chart',
  };
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

// Convert the previous format (pairs with fast/slow, per-group lines switch) to the current one
const migrateGroup = (saved: any, fallback: CloudGroup): CloudGroup => {
  if (!saved) return cloneGroup(fallback);
  if (Array.isArray(saved.clouds)) {
    return {
      ...cloneGroup(fallback),
      ...saved,
      visibility: { ...fallback.visibility, ...(saved.visibility ?? {}) },
      clouds: saved.clouds.map((c: Cloud, i: number) => ({
        ...(fallback.clouds[i] ?? newCloud(fallback.clouds)),
        ...c,
        tf: validTf(c.tf),
      })),
    };
  }
  const groupTf = validTf(saved.tf);
  const pairs: any[] = Array.isArray(saved.pairs) ? saved.pairs : [];
  const base = cloneGroup(fallback);
  return {
    ...base,
    enabled: !!saved.enabled,
    clouds: pairs.map((p, i) => ({
      ...(base.clouds[i] ?? newCloud(base.clouds)),
      enabled: p.enabled !== false,
      short: p.fast ?? 8,
      long: p.slow ?? 9,
      tf: validTf(p.tf ?? groupTf),
      fill: typeof p.fill === 'boolean' ? p.fill : true,
      lines: typeof p.lines === 'boolean' ? p.lines : !!saved.showLines,
    })),
  };
};

export const loadCloudConfig = (): CloudConfig => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return {
      ripster: migrateGroup(saved?.ripster, DEFAULT_CLOUDS.ripster),
      mtf: migrateGroup(saved?.mtf, DEFAULT_CLOUDS.mtf),
    };
  } catch {
    return { ripster: cloneGroup(DEFAULT_CLOUDS.ripster), mtf: cloneGroup(DEFAULT_CLOUDS.mtf) };
  }
};

export const saveCloudConfig = (c: CloudConfig) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
};
