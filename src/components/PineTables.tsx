import React from 'react';
import { PineTable } from '../pine';
import './PineTables.css';

const SIZES: Record<string, number> = { tiny: 8, small: 10, normal: 12, large: 16, huge: 22, auto: 11 };
const sizeOf = (s?: string) => SIZES[(s ?? 'size.normal').replace('size.', '')] ?? 11;

/** Position names (position.top_right ...) as a row and a column of the 3 x 3 grid around the chart */
const spot = (p: string): string => {
  const k = p.replace('position.', '');
  return ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'].includes(k) ? k : 'top_right';
};

const css = (c?: string) => (c && /^(#|rgb)/i.test(c) ? c : undefined);

const Table: React.FC<{ t: PineTable }> = ({ t }) => {
  // cells covered by a merged cell are not drawn
  const covered = new Set<string>();
  t.cells.forEach((c) => {
    for (let r = 0; r < c.rowspan; r++) for (let k = 0; k < c.colspan; k++) if (r || k) covered.add(`${c.col + k},${c.row + r}`);
  });
  const byKey = new Map(t.cells.map((c) => [`${c.col},${c.row}`, c]));
  const out: React.ReactNode[] = [];
  for (let r = 0; r < t.rows; r++) {
    for (let k = 0; k < t.columns; k++) {
      if (covered.has(`${k},${r}`)) continue;
      const c = byKey.get(`${k},${r}`);
      out.push(
        <div
          key={`${k},${r}`}
          className="pt-cell"
          style={{
            gridColumn: `${k + 1} / span ${c?.colspan ?? 1}`,
            gridRow: `${r + 1} / span ${c?.rowspan ?? 1}`,
            color: css(c?.textColor),
            background: css(c?.bgcolor),
            fontSize: sizeOf(c?.size),
            textAlign: c?.halign?.includes('left') ? 'left' : c?.halign?.includes('right') ? 'right' : c?.halign?.includes('center') ? 'center' : undefined,
            borderColor: css(t.borderColor),
          }}
        >
          {c?.text ?? ''}
        </div>
      );
    }
  }
  return (
    <div className="pt-table" style={{ gridTemplateColumns: `repeat(${t.columns}, auto)`, background: css(t.bgcolor), borderColor: css(t.borderColor) }}>
      {out}
    </div>
  );
};

/** Tables a Pine script drew, shown over the chart at their positions (top right, bottom left ...) */
export const PineTables: React.FC<{ tables: PineTable[] }> = ({ tables }) => {
  if (!tables.length) return null;
  const spots = [...new Set(tables.map((t) => spot(t.position)))];
  return (
    <>
      {spots.map((p) => (
        <div key={p} className={`pt-spot pt-${p}`}>
          {tables.filter((t) => spot(t.position) === p).map((t, i) => <Table key={`${t.id}-${i}`} t={t} />)}
        </div>
      ))}
    </>
  );
};
