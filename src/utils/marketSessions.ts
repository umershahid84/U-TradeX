// US equity trading sessions, in New York time. Holidays are not modelled.
export type Session = 'pre' | 'regular' | 'post' | 'overnight' | 'closed';

export const SESSION_LABEL: Record<Session, string> = {
  pre: 'Pre-market',
  regular: 'Market open',
  post: 'After hours',
  overnight: 'Overnight',
  closed: 'Closed',
};

export const SESSION_COLOR: Record<Session, string> = {
  pre: '#42a5f5',
  regular: '#26a69a',
  post: '#ffa726',
  overnight: '#9575cd',
  closed: '#787b9a',
};

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const sessionAt = (ms: number): Session => {
  const parts: Record<string, string> = {};
  fmt.formatToParts(new Date(ms)).forEach((p) => (parts[p.type] = p.value));
  const day = DAYS[parts.weekday];
  const mins = (+parts.hour % 24) * 60 + +parts.minute;

  if (day === 6) return 'closed';
  if (day === 0) return mins >= 20 * 60 ? 'overnight' : 'closed';
  if (mins < 4 * 60) return 'overnight'; // after the previous evening's 8pm open (Mon: Sunday night)
  if (mins < 9 * 60 + 30) return 'pre';
  if (mins < 16 * 60) return 'regular';
  if (mins < 20 * 60) return 'post';
  return day === 5 ? 'closed' : 'overnight';
};

export interface SessionBand {
  session: Session;
  /** First and last bar time (ms) in the band */
  start: number;
  end: number;
}

export interface SessionGap {
  /** Last bar before and first bar after the gap (ms) */
  from: number;
  to: number;
  kind: 'overnight' | 'closed';
}

/** True when the bars are intraday (spaced under a day apart) so sessions are meaningful */
export const isIntraday = (data: { time: number }[]): boolean =>
  data.length > 1 && data[1].time - data[0].time < 20 * 60 * 60 * 1000;

/** Groups consecutive bars of the same session, and finds the gaps where no bars exist overnight */
export const buildSessionLayout = (data: { time: number }[]): { bands: SessionBand[]; gaps: SessionGap[] } => {
  const bands: SessionBand[] = [];
  const gaps: SessionGap[] = [];
  if (!isIntraday(data)) return { bands, gaps };

  const diffs = data.slice(1).map((d, i) => d.time - data[i].time).sort((a, b) => a - b);
  const barMs = diffs[Math.floor(diffs.length / 2)];

  data.forEach((d, i) => {
    const session = sessionAt(d.time);
    const band = bands[bands.length - 1];
    if (band && band.session === session && d.time - band.end <= barMs * 2) band.end = d.time;
    else bands.push({ session, start: d.time, end: d.time });

    if (i > 0 && d.time - data[i - 1].time > barMs * 3) {
      const mid = (d.time + data[i - 1].time) / 2;
      const s = sessionAt(mid);
      if (s === 'overnight' || s === 'closed') gaps.push({ from: data[i - 1].time, to: d.time, kind: s });
    }
  });
  return { bands, gaps };
};
