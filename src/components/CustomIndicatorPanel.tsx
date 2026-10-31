import React, { useState } from 'react';
import { CustomIndicator, CustomIndicatorLanguage, CustomIndicatorStatus } from '../types';
import { PINE_EXAMPLES } from '../pine/examples';
import './CustomIndicatorPanel.css';

export type { CustomIndicator } from '../types';

interface CustomIndicatorPanelProps {
  indicators: CustomIndicator[];
  statuses: Record<string, CustomIndicatorStatus>;
  onAddIndicator: (indicator: CustomIndicator) => void;
  onUpdateIndicator: (id: string, patch: Partial<CustomIndicator>) => void;
  onRemoveIndicator: (id: string) => void;
}

const JS_EXAMPLE = 'prices.map((p, i) => i < 19 ? NaN : prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20)';

export const CustomIndicatorPanel: React.FC<CustomIndicatorPanelProps> = ({
  indicators,
  statuses,
  onAddIndicator,
  onUpdateIndicator,
  onRemoveIndicator,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null); // 'new' or an indicator id
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<CustomIndicatorLanguage>('pine');
  const [source, setSource] = useState(PINE_EXAMPLES[0].source);
  const [color, setColor] = useState('#2196F3');
  const [lineWidth, setLineWidth] = useState(2);
  const [showHelp, setShowHelp] = useState(false);

  const openNew = () => {
    setEditingId('new');
    setName('');
    setLanguage('pine');
    setSource(PINE_EXAMPLES[0].source);
    setColor('#2196F3');
    setLineWidth(2);
  };

  const openEdit = (ind: CustomIndicator) => {
    setEditingId(ind.id);
    setName(ind.name);
    setLanguage(ind.language);
    setSource(ind.source);
    setColor(ind.color);
    setLineWidth(ind.lineWidth);
  };

  const switchLanguage = (lang: CustomIndicatorLanguage) => {
    setLanguage(lang);
    if (editingId === 'new') setSource(lang === 'pine' ? PINE_EXAMPLES[0].source : JS_EXAMPLE);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim()) return;
    const pineTitle = /indicator\(\s*["']([^"']+)["']/.exec(source)?.[1];
    const finalName = name.trim() || pineTitle || 'My Indicator';
    if (editingId === 'new') {
      onAddIndicator({
        id: Date.now().toString(), name: finalName, language, source, color, lineWidth, enabled: true,
      });
    } else if (editingId) {
      onUpdateIndicator(editingId, { name: finalName, language, source, color, lineWidth, inputValues: {} });
    }
    setEditingId(null);
  };

  // Tab inserts two spaces in the code editor instead of moving focus
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: en } = el;
    const next = source.slice(0, s) + '    ' + source.slice(en);
    setSource(next);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
  };

  return (
    <div className="custom-indicator-panel">
      <div className="panel-header">
        <h3>Custom Indicators</h3>
        {editingId ? (
          <button onClick={() => setEditingId(null)} className="add-btn cancel">✖ Cancel</button>
        ) : (
          <button onClick={openNew} className="add-btn">+ New Indicator</button>
        )}
      </div>

      {editingId && (
        <form onSubmit={handleSubmit} className="indicator-form">
          <div className="lang-tabs">
            <button type="button" className={language === 'pine' ? 'active' : ''} onClick={() => switchLanguage('pine')}>
              Pine Script
            </button>
            <button type="button" className={language === 'js' ? 'active' : ''} onClick={() => switchLanguage('js')}>
              JavaScript
            </button>
          </div>

          <div className="form-group">
            <label>Name (optional):</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from indicator() if empty" />
          </div>

          {language === 'pine' && (
            <div className="form-group">
              <label>Start from an example:</label>
              <select
                value=""
                onChange={(e) => {
                  const ex = PINE_EXAMPLES.find((x) => x.name === e.target.value);
                  if (ex) setSource(ex.source);
                }}
              >
                <option value="">Choose…</option>
                {PINE_EXAMPLES.map((ex) => (
                  <option key={ex.name} value={ex.name}>{ex.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>{language === 'pine' ? 'Pine Script (v5 / v4):' : 'Formula (JavaScript):'}</label>
            <textarea
              className="code-editor"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={onKeyDown}
              rows={language === 'pine' ? 14 : 4}
              spellCheck={false}
              required
            />
            <small className="help-text">
              {language === 'pine'
                ? 'Paste a script from TradingView. Use indicator(..., overlay=true) to draw on the price chart, or false for a separate pane.'
                : 'Return an array with one number per bar (NaN for no value). Available: prices, close, open, high, low, volume.'}
            </small>
          </div>

          {language === 'js' && (
            <div className="form-row">
              <div className="form-group">
                <label>Color:</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Line Width:</label>
                <input type="number" value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} min="1" max="4" />
              </div>
            </div>
          )}

          <button type="submit" className="submit-btn">
            {editingId === 'new' ? 'Add to Chart' : 'Save Changes'}
          </button>
        </form>
      )}

      {indicators.length === 0 && !editingId && (
        <p className="empty-note">No custom indicators yet. Click “New Indicator” and paste a Pine Script.</p>
      )}

      {indicators.length > 0 && (
        <div className="indicators-list">
          {indicators.map((ind) => {
            const status = statuses[ind.id];
            return (
              <div key={ind.id} className="indicator-card">
                <div className="indicator-item">
                  <label className="indicator-info">
                    <input
                      type="checkbox"
                      checked={ind.enabled}
                      onChange={(e) => onUpdateIndicator(ind.id, { enabled: e.target.checked })}
                    />
                    <span className="indicator-name">{ind.name}</span>
                    <span className="lang-badge">{ind.language === 'pine' ? 'Pine' : 'JS'}</span>
                  </label>
                  <div className="indicator-actions">
                    <button onClick={() => openEdit(ind)} className="edit-btn" title="Edit code">✎</button>
                    <button onClick={() => onRemoveIndicator(ind.id)} className="remove-btn" title="Remove">✖</button>
                  </div>
                </div>

                {ind.enabled && status?.error && (
                  <div className="indicator-error">
                    {status.errorLine ? `Line ${status.errorLine}: ` : ''}{status.error}
                  </div>
                )}
                {ind.enabled && status?.warnings.map((w) => (
                  <div key={w} className="indicator-warning">{w}</div>
                ))}

                {ind.enabled && !status?.error && status?.inputs.length > 0 && (
                  <div className="indicator-inputs">
                    {status.inputs.map((inp) => {
                      const set = (value: number | boolean | string) =>
                        onUpdateIndicator(ind.id, { inputValues: { ...ind.inputValues, [inp.id]: value } });
                      return (
                        <label key={inp.id} className="input-row">
                          <span>{inp.title}</span>
                          {inp.type === 'bool' ? (
                            <input type="checkbox" checked={!!inp.value} onChange={(e) => set(e.target.checked)} />
                          ) : inp.type === 'int' || inp.type === 'float' ? (
                            <input
                              type="number"
                              value={inp.value as number}
                              min={inp.min}
                              max={inp.max}
                              step={inp.step ?? (inp.type === 'int' ? 1 : 0.1)}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (Number.isFinite(v)) set(v);
                              }}
                            />
                          ) : inp.type === 'source' ? (
                            <select value={String(inp.value)} onChange={(e) => set(e.target.value)}>
                              {['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume'].map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : inp.options ? (
                            <select value={String(inp.value)} onChange={(e) => set(e.target.value)}>
                              {inp.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input type="text" value={String(inp.value)} onChange={(e) => set(e.target.value)} />
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button className="help-toggle" onClick={() => setShowHelp(!showHelp)}>
        {showHelp ? '▾' : '▸'} Supported Pine Script features
      </button>
      {showHelp && (
        <div className="help-section">
          <p><strong>Language:</strong> v4 and v5 syntax, <code>var</code>, <code>:=</code>, <code>if / for / while</code>, user functions, tuples, history <code>x[1]</code>, ternary.</p>
          <p><strong>ta.*</strong> sma, ema, rma, wma, hma, vwma, rsi, macd, bb, stdev, atr, tr, stoch, cci, mfi, wpr, dmi, supertrend, highest, lowest, sum, cum, change, mom, roc, crossover, crossunder, cross, barssince, valuewhen, pivothigh, pivotlow, vwap, obv</p>
          <p><strong>Other:</strong> math.*, nz, na, fixnan, color.new/rgb, input.int/float/bool/string/source.</p>
          <p><strong>Output:</strong> plot (line, histogram, step, circles), hline, fill, plotshape, plotchar.</p>
          <p className="muted">Not supported: strategies, request.security, labels/lines/boxes, arrays and maps. Unsupported drawing calls are ignored with a warning.</p>
        </div>
      )}
    </div>
  );
};
