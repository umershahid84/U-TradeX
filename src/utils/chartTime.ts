import { Time } from 'lightweight-charts';

// Charts label times in New York time (EST in winter, EDT in summer), the exchange clock, not UTC or the
// computer's own zone, so 9:30 is the open and 16:00 is the close whatever the viewer's location.
const ZONE = 'America/New_York';

const hm = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hms = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, day: 'numeric' });
const month = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short' });
const year = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric' });
const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const toDate = (t: Time): Date | null => {
  if (typeof t === 'number') return new Date(t * 1000);
  if (typeof t === 'string') return new Date(`${t}T12:00:00Z`);
  if (t && typeof t === 'object') return new Date(Date.UTC(t.year, t.month - 1, t.day, 12));
  return null;
};

/** Axis labels. `type` is lightweight-charts' TickMarkType: 0 year, 1 month, 2 day, 3 time, 4 time with seconds */
export const etTickFormatter = (time: Time, type: number): string => {
  const d = toDate(time);
  if (!d) return '';
  switch (type) {
    case 0: return year.format(d);
    case 1: return month.format(d);
    case 2: return day.format(d);
    case 4: return hms.format(d);
    default: return hm.format(d);
  }
};

/** Crosshair label, e.g. "13 Nov '26, 09:35" (New York time) */
export const etTimeFormatter = (time: Time): string => {
  const d = toDate(time);
  if (!d) return '';
  const p: Record<string, string> = {};
  parts.formatToParts(d).forEach((x) => x.type !== 'literal' && (p[x.type] = x.value));
  return `${p.day} ${p.month} '${p.year} ${p.hour}:${p.minute}`;
};

/** Options to merge into a chart's creation options so its time axis and crosshair use New York time */
export const etTimeOptions = {
  localization: { timeFormatter: etTimeFormatter },
  timeScale: { tickMarkFormatter: etTickFormatter },
};
