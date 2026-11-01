import React, { useEffect, useState } from 'react';
import { CLOUD_TFS, CloudTf, MaType, PRICE_SOURCES, PriceSource } from '../../utils/htfEma';
import { Cloud, CloudInstance, DEFAULT_CLOUDS, CLOUD_TITLES } from './cloudConfig';
import './CloudSettingsDialog.css';

interface Props {
  instance: CloudInstance;
  /** Bar length of the chart in ms; marks timeframes finer than it */
  chartMs: number;
  onApply: (instance: CloudInstance) => void;
  onClose: () => void;
}

type Tab = 'inputs' | 'style' | 'visibility';

const VIS_LABELS: { key: keyof CloudInstance['visibility']; label: string }[] = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'hours', label: 'Hours' },
  { key: 'days', label: 'Days' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'months', label: 'Months' },
];

const int = (v: string, min: number, max: number, fallback: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * Settings for a cloud indicator, laid out like TradingView's dialog (Inputs, Style, Visibility)
 * and using the same labels and order as the Ripster scripts. The Inputs the scripts declare but
 * never use are left out: "Offset" and the alert switches in Ripster EMA Clouds, and "Leading
 * Period" in Ripster MTF Clouds.
 */
export const CloudSettingsDialog: React.FC<Props> = ({ instance, chartMs, onApply, onClose }) => {
  const [tab, setTab] = useState<Tab>('inputs');
  const [draft, setDraft] = useState<CloudInstance>(() => JSON.parse(JSON.stringify(instance)));
  const cloudKey = instance.kind;
  const isMtf = cloudKey === 'mtf';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setCloud = (i: number, patch: Partial<Cloud>) =>
    setDraft((d) => ({ ...d, clouds: d.clouds.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const lenLabel = (i: number, which: 'Short' | 'Long') => (isMtf ? `EMA ${i + 1} ${which} Length` : `${which} EMA${i + 1} Length`);
  const tfOptions = (
    <>
      {CLOUD_TFS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}{o.value !== 'chart' && o.ms < chartMs ? ' (finer than chart)' : ''}
        </option>
      ))}
    </>
  );

  const allLines = draft.clouds.length > 0 && draft.clouds.every((c) => c.lines);

  const colorRow = (label: string, value: string, onChange: (v: string) => void) => (
    <>
      <span className="csd-lbl">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour`} />
    </>
  );

  const widthSelect = (value: number, onChange: (w: Cloud['shortWidth']) => void) => (
    <select value={value} onChange={(e) => onChange(+e.target.value as Cloud['shortWidth'])} aria-label="Line width">
      {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}
    </select>
  );

  return (
    <div className="csd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="csd" role="dialog" aria-label={`${CLOUD_TITLES[cloudKey]} settings`}>
        <div className="csd-head">
          <h3>{CLOUD_TITLES[cloudKey]}</h3>
          <button type="button" className="csd-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="csd-tabs" role="tablist">
          {(['inputs', 'style', 'visibility'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'inputs' ? 'Inputs' : t === 'style' ? 'Style' : 'Visibility'}
            </button>
          ))}
        </div>

        <div className="csd-body">
          {tab === 'inputs' && (
            <>
              {!isMtf && (
                <div className="csd-row">
                  <label>MA Type</label>
                  <select value={draft.maType} onChange={(e) => setDraft({ ...draft, maType: e.target.value as MaType })}>
                    <option value="EMA">EMA</option>
                    <option value="SMA">SMA</option>
                  </select>
                </div>
              )}

              {draft.clouds.map((c, i) => (
                <React.Fragment key={i}>
                  <div className="csd-row">
                    <label>{lenLabel(i, 'Short')}</label>
                    <input type="number" min={1} max={999} value={c.short} onChange={(e) => setCloud(i, { short: int(e.target.value, 1, 999, c.short) })} />
                  </div>
                  <div className="csd-row">
                    <label>{lenLabel(i, 'Long')}</label>
                    <input type="number" min={1} max={999} value={c.long} onChange={(e) => setCloud(i, { long: int(e.target.value, 1, 999, c.long) })} />
                  </div>
                </React.Fragment>
              ))}

              {isMtf && (
                <div className="csd-row">
                  <label>Resolution</label>
                  <select value={draft.resolution} onChange={(e) => setDraft({ ...draft, resolution: e.target.value as CloudTf })}>
                    {tfOptions}
                  </select>
                </div>
              )}

              <div className="csd-row">
                <label>Source</label>
                <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as PriceSource })}>
                  {PRICE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              {isMtf && (
                <div className="csd-row">
                  <label>Offset</label>
                  <input type="number" min={-500} max={500} value={draft.offset} onChange={(e) => setDraft({ ...draft, offset: int(e.target.value, -500, 500, 0) })} />
                </div>
              )}

              {!isMtf && (
                <>
                  <label className="csd-check-row">
                    <input
                      type="checkbox"
                      checked={allLines}
                      onChange={(e) => setDraft((d) => ({ ...d, clouds: d.clouds.map((c) => ({ ...c, lines: e.target.checked })) }))}
                    />
                    Display EMA Line
                  </label>
                  {draft.clouds.map((c, i) => (
                    <label key={i} className="csd-check-row">
                      <input type="checkbox" checked={c.enabled} onChange={() => setCloud(i, { enabled: !c.enabled })} />
                      Show EMA Cloud-{i + 1}
                    </label>
                  ))}
                  <div className="csd-row">
                    <label>Leading Period For EMA Cloud</label>
                    <input type="number" min={0} max={500} value={draft.offset} onChange={(e) => setDraft({ ...draft, offset: int(e.target.value, 0, 500, 0) })} />
                  </div>
                </>
              )}

            </>
          )}

          {tab === 'style' && (
            <>
              {draft.clouds.map((c, i) => (
                <div key={i} className={`csd-style-card ${c.enabled ? '' : 'off'}`}>
                  <div className="csd-style-title">{isMtf ? `EMA ${i + 1}` : `EMA Cloud-${i + 1}`} · {c.short}/{c.long}</div>

                  <div className="csd-style-row">
                    <label className="csd-check">
                      <input type="checkbox" checked={c.fill} onChange={() => setCloud(i, { fill: !c.fill })} /> {isMtf ? `EMA ${i + 1} Cloud` : `MA Cloud${i + 1}`}
                    </label>
                    {isMtf ? (
                      <>
                        <input type="color" value={c.bull} onChange={(e) => setCloud(i, { bull: e.target.value, bear: e.target.value })} aria-label="Cloud colour" />
                        <input type="range" min={0} max={100} value={c.bullOpacity} onChange={(e) => setCloud(i, { bullOpacity: +e.target.value, bearOpacity: +e.target.value })} aria-label="Cloud opacity" />
                        <span className="csd-pct">{c.bullOpacity}%</span>
                      </>
                    ) : (
                      <>
                        {colorRow('Short ≥ Long', c.bull, (v) => setCloud(i, { bull: v }))}
                        <input type="range" min={0} max={100} value={c.bullOpacity} onChange={(e) => setCloud(i, { bullOpacity: +e.target.value })} aria-label="Opacity when short is above long" />
                        <span className="csd-pct">{c.bullOpacity}%</span>
                      </>
                    )}
                  </div>
                  {!isMtf && (
                    <div className="csd-style-row">
                      <span className="csd-spacer" />
                      {colorRow('Short < Long', c.bear, (v) => setCloud(i, { bear: v }))}
                      <input type="range" min={0} max={100} value={c.bearOpacity} onChange={(e) => setCloud(i, { bearOpacity: +e.target.value })} aria-label="Opacity when short is below long" />
                      <span className="csd-pct">{c.bearOpacity}%</span>
                    </div>
                  )}

                  <div className="csd-style-row">
                    <label className="csd-check">
                      <input type="checkbox" checked={c.lines} onChange={() => setCloud(i, { lines: !c.lines })} /> Lines
                    </label>
                    <span className="csd-lbl wide">{isMtf ? `EMA ${i + 1} Short` : `Short Leading EMA${i + 1}`}</span>
                    {isMtf ? (
                      <input type="color" value={c.shortUp} onChange={(e) => setCloud(i, { shortUp: e.target.value, shortDown: e.target.value })} aria-label="Short line colour" />
                    ) : (
                      <>
                        {colorRow('Rising', c.shortUp, (v) => setCloud(i, { shortUp: v }))}
                        {colorRow('Falling', c.shortDown, (v) => setCloud(i, { shortDown: v }))}
                      </>
                    )}
                    {widthSelect(c.shortWidth, (w) => setCloud(i, { shortWidth: w }))}
                  </div>
                  <div className="csd-style-row">
                    <span className="csd-spacer" />
                    <span className="csd-lbl wide">{isMtf ? `EMA ${i + 1} Long` : `Long Leading EMA${i + 1}`}</span>
                    {isMtf ? (
                      <input type="color" value={c.longUp} onChange={(e) => setCloud(i, { longUp: e.target.value, longDown: e.target.value })} aria-label="Long line colour" />
                    ) : (
                      <>
                        {colorRow('Rising', c.longUp, (v) => setCloud(i, { longUp: v }))}
                        {colorRow('Falling', c.longDown, (v) => setCloud(i, { longDown: v }))}
                      </>
                    )}
                    {widthSelect(c.longWidth, (w) => setCloud(i, { longWidth: w }))}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'visibility' && (
            <>
              <p className="csd-note csd-top">Show this indicator on charts with these candle sizes:</p>
              {VIS_LABELS.map(({ key, label }) => (
                <label key={key} className="csd-vis">
                  <input
                    type="checkbox"
                    checked={draft.visibility[key]}
                    onChange={() => setDraft((d) => ({ ...d, visibility: { ...d.visibility, [key]: !d.visibility[key] } }))}
                  />
                  {label}
                </label>
              ))}
            </>
          )}
        </div>

        <div className="csd-foot">
          <button type="button" className="csd-defaults" onClick={() => setDraft((d) => ({ ...JSON.parse(JSON.stringify(DEFAULT_CLOUDS[cloudKey])), id: d.id, kind: d.kind, enabled: d.enabled }))}>
            Defaults
          </button>
          <span className="csd-spacer-grow" />
          <button type="button" className="csd-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="csd-ok" onClick={() => { onApply(draft); onClose(); }}>Ok</button>
        </div>
      </div>
    </div>
  );
};
