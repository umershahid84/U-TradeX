import React, { useEffect, useState } from 'react';
import { CLOUD_TFS, MaType, PRICE_SOURCES, PriceSource } from '../../utils/htfEma';
import {
  Cloud, CloudGroup, CloudKey, CLOUD_TITLES, DEFAULT_CLOUDS, MAX_CLOUDS, cloneGroup, newCloud,
} from './cloudConfig';
import './CloudSettingsDialog.css';

interface Props {
  cloudKey: CloudKey;
  group: CloudGroup;
  /** Bar length of the chart in ms; marks timeframes finer than it */
  chartMs: number;
  onApply: (group: CloudGroup) => void;
  onClose: () => void;
}

type Tab = 'inputs' | 'style' | 'visibility';

const VIS_LABELS: { key: keyof CloudGroup['visibility']; label: string }[] = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'hours', label: 'Hours' },
  { key: 'days', label: 'Days' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'months', label: 'Months' },
];

const num = (v: string, min: number, max: number, fallback: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Settings for a cloud indicator, laid out like TradingView's: Inputs, Style and Visibility tabs */
export const CloudSettingsDialog: React.FC<Props> = ({ cloudKey, group, chartMs, onApply, onClose }) => {
  const [tab, setTab] = useState<Tab>('inputs');
  const [draft, setDraft] = useState<CloudGroup>(() => cloneGroup(group));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setCloud = (i: number, patch: Partial<Cloud>) =>
    setDraft((d) => ({ ...d, clouds: d.clouds.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

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
              <div className="csd-row">
                <label>MA type</label>
                <select value={draft.maType} onChange={(e) => setDraft({ ...draft, maType: e.target.value as MaType })}>
                  <option value="EMA">EMA</option>
                  <option value="SMA">SMA</option>
                </select>
              </div>
              <div className="csd-row">
                <label>Source</label>
                <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as PriceSource })}>
                  {PRICE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="csd-row">
                <label>Offset</label>
                <input
                  type="number" min={-100} max={100} value={draft.offset}
                  onChange={(e) => setDraft({ ...draft, offset: num(e.target.value, -100, 100, 0) })}
                />
              </div>

              <div className="csd-section">Clouds</div>
              <div className="csd-cloud-head">
                <span /><span>Show</span><span>Short</span><span>Long</span><span>Timeframe</span><span />
              </div>
              {draft.clouds.map((c, i) => (
                <div key={i} className={`csd-cloud-row ${c.enabled ? '' : 'off'}`}>
                  <span className="csd-n">Cloud {i + 1}</span>
                  <input type="checkbox" checked={c.enabled} onChange={() => setCloud(i, { enabled: !c.enabled })} aria-label={`Show cloud ${i + 1}`} />
                  <input type="number" min={1} max={999} value={c.short} onChange={(e) => setCloud(i, { short: num(e.target.value, 1, 999, c.short) })} aria-label="Short length" />
                  <input type="number" min={1} max={999} value={c.long} onChange={(e) => setCloud(i, { long: num(e.target.value, 1, 999, c.long) })} aria-label="Long length" />
                  <select value={c.tf} onChange={(e) => setCloud(i, { tf: e.target.value as Cloud['tf'] })} aria-label="Timeframe">
                    {CLOUD_TFS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}{o.value !== 'chart' && o.ms < chartMs ? ' (finer than chart)' : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="csd-remove" onClick={() => setDraft((d) => ({ ...d, clouds: d.clouds.filter((_, j) => j !== i) }))} title="Remove cloud">✖</button>
                </div>
              ))}
              {draft.clouds.length < MAX_CLOUDS && (
                <button type="button" className="csd-add" onClick={() => setDraft((d) => ({ ...d, clouds: [...d.clouds, newCloud(d.clouds)] }))}>
                  + Add cloud
                </button>
              )}
              <p className="csd-note">
                Each cloud takes its two averages from the candles of its own timeframe, so one chart can mix, for example,
                5/12 on the chart's candles with 34/50 on hourly and 72/89 on daily candles.
              </p>
            </>
          )}

          {tab === 'style' && (
            <>
              {draft.clouds.map((c, i) => (
                <div key={i} className={`csd-style-card ${c.enabled ? '' : 'off'}`}>
                  <div className="csd-style-title">Cloud {i + 1} · {c.short}/{c.long}</div>

                  <div className="csd-style-row">
                    <label className="csd-check">
                      <input type="checkbox" checked={c.fill} onChange={() => setCloud(i, { fill: !c.fill })} /> Cloud
                    </label>
                    <span className="csd-lbl">Bullish</span>
                    <input type="color" value={c.bull} onChange={(e) => setCloud(i, { bull: e.target.value })} aria-label="Bullish colour" />
                    <input type="range" min={0} max={100} value={c.bullOpacity} onChange={(e) => setCloud(i, { bullOpacity: +e.target.value })} aria-label="Bullish opacity" />
                    <span className="csd-pct">{c.bullOpacity}%</span>
                  </div>
                  <div className="csd-style-row">
                    <span className="csd-spacer" />
                    <span className="csd-lbl">Bearish</span>
                    <input type="color" value={c.bear} onChange={(e) => setCloud(i, { bear: e.target.value })} aria-label="Bearish colour" />
                    <input type="range" min={0} max={100} value={c.bearOpacity} onChange={(e) => setCloud(i, { bearOpacity: +e.target.value })} aria-label="Bearish opacity" />
                    <span className="csd-pct">{c.bearOpacity}%</span>
                  </div>

                  <div className="csd-style-row">
                    <label className="csd-check">
                      <input type="checkbox" checked={c.lines} onChange={() => setCloud(i, { lines: !c.lines })} /> EMA lines
                    </label>
                    <span className="csd-lbl">Short</span>
                    <input type="color" value={c.shortColor} onChange={(e) => setCloud(i, { shortColor: e.target.value })} aria-label="Short line colour" />
                    <span className="csd-lbl">Long</span>
                    <input type="color" value={c.longColor} onChange={(e) => setCloud(i, { longColor: e.target.value })} aria-label="Long line colour" />
                    <select value={c.lineWidth} onChange={(e) => setCloud(i, { lineWidth: +e.target.value as Cloud['lineWidth'] })} aria-label="Line width">
                      {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}
                    </select>
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
          <button type="button" className="csd-defaults" onClick={() => setDraft((d) => ({ ...cloneGroup(DEFAULT_CLOUDS[cloudKey]), enabled: d.enabled }))}>
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
