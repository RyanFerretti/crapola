import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ValidationIssue } from '@crapola/engine';
import { ApiError, type EDoc, type ERule, type Reference, api } from '../api.ts';
import { PlayDrawer } from '../components/PlayDrawer.tsx';
import { RuleEditor } from '../components/RuleEditor.tsx';
import { Field, Issues, NumberInput, PageHead, Select, TextInput } from '../components/ui.tsx';
import { navigate } from '../router.ts';

const ODDS = ['1x', '2x', '3x', '3-4-5x', '5x', '10x', '20x', '100x'] as const;
const ROUNDING = ['up', 'down', 'nearest', 'none'] as const;

function blankDoc(): EDoc {
  return {
    version: 1,
    id: '',
    name: '',
    description: '',
    tags: [],
    unit: 10,
    bankroll: 500,
    rules: [
      { id: 'line', on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: '1u' }] },
      { id: 'odds', on: 'pointEstablished', do: [{ action: 'bet', type: 'odds', on: 'pass', max: true }] },
    ],
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function StrategyEditor({ id }: { id: string | null }) {
  const [doc, setDoc] = useState<EDoc | null>(id ? null : blankDoc());
  const [ref, setRef] = useState<Reference | null>(null);
  const [tab, setTab] = useState<'form' | 'json' | 'help'>('form');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [playing, setPlaying] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('play') === '1');
  const validateTimer = useRef<number | null>(null);

  useEffect(() => {
    api.reference().then(setRef).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .strategy(id)
      .then((s) => {
        setDoc(s.doc);
        setIssues(s.issues);
        setWarnings(s.warnings);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // Keep the JSON tab in sync when the form changes.
  useEffect(() => {
    if (doc && tab !== 'json') setJson(JSON.stringify(doc, null, 2));
  }, [doc, tab]);

  // Live validation, debounced.
  useEffect(() => {
    if (!doc) return;
    if (validateTimer.current) window.clearTimeout(validateTimer.current);
    validateTimer.current = window.setTimeout(() => {
      api
        .validate(doc)
        .then((v) => {
          setIssues(v.issues);
          setWarnings(v.warnings);
        })
        .catch(() => {});
    }, 300);
  }, [doc]);

  const update = useCallback((fn: (d: EDoc) => void) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setStatus(null);
  }, []);

  const setKey = <K extends keyof EDoc>(k: K, v: EDoc[K] | undefined) =>
    update((d) => {
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete d[k];
      else d[k] = v;
    });
  const setNested = (group: 'table' | 'exit', k: string, v: unknown) =>
    update((d) => {
      const g = { ...(d[group] ?? {}) } as Record<string, unknown>;
      if (v === undefined || v === '' || Number.isNaN(v)) delete g[k];
      else g[k] = v;
      if (Object.keys(g).length) d[group] = g;
      else delete d[group];
    });

  const onJson = (text: string) => {
    setJson(text);
    try {
      const parsed = JSON.parse(text) as EDoc;
      setJsonError(null);
      setDoc(parsed);
      setDirty(true);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const save = async () => {
    if (!doc) return;
    setError(null);
    try {
      if (!doc.id && doc.name) doc.id = slugify(doc.name);
      const res = id ? await api.saveStrategy(id, doc) : await api.createStrategy(doc);
      setDirty(false);
      setStatus(`saved strategies/${res.id}.json`);
      setWarnings(res.warnings);
      if (!id || res.id !== id) navigate(`/strategies/${res.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.issues) setIssues(e.issues);
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!id || !confirm(`Delete strategies/${id}.json?`)) return;
    await api.deleteStrategy(id);
    navigate('/');
  };

  const vars = useMemo(() => Object.entries(doc?.variables ?? {}), [doc]);

  if (error && !doc) return <div className="issues">{error}</div>;
  if (!doc) return <div className="muted">loading…</div>;

  const table = (doc.table ?? {}) as Record<string, number | string | undefined>;
  const exit = (doc.exit ?? {}) as Record<string, number | string | undefined>;

  return (
    <>
      <PageHead
        eyebrow={id ? 'Edit strategy' : 'New strategy'}
        title={doc.name || 'Untitled strategy'}
        blurb={doc.description}
        actions={
          <>
            {status && <span className="tag ok">{status}</span>}
            {dirty && <span className="tag">unsaved</span>}
            <button onClick={() => setPlaying(true)}>▶ Play</button>
            {id && (
              <a className="btn" href={`#/run?ids=${encodeURIComponent(id)}`}>
                Run batch
              </a>
            )}
            {id && (
              <button className="danger" onClick={remove}>
                Delete
              </button>
            )}
            <button className="primary" onClick={save} disabled={issues.length > 0 && tab !== 'json'}>
              Save
            </button>
          </>
        }
      />
      {error && <div className="issues">{error}</div>}
      <Issues issues={issues} warnings={warnings} okText={dirty ? 'valid, not saved yet' : undefined} />

      <div className="tabs">
        <button className={tab === 'form' ? 'active' : ''} onClick={() => setTab('form')}>
          Builder
        </button>
        <button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>
          Raw JSON
        </button>
        <button className={tab === 'help' ? 'active' : ''} onClick={() => setTab('help')}>
          Reference
        </button>
      </div>

      {tab === 'json' && (
        <div className="card">
          {jsonError && <div className="issues">JSON: {jsonError}</div>}
          <textarea className="code" value={json} onChange={(e) => onJson(e.target.value)} spellCheck={false} />
        </div>
      )}

      {tab === 'help' && (
        <div className="grid side">
          <div className="card">
            <h3>Identifiers</h3>
            <table className="data">
              <tbody>
                {Object.entries(ref?.identifiers ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <code>{k}</code>
                    </td>
                    <td style={{ textAlign: 'left' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 style={{ marginTop: 18 }}>Functions</h3>
            <table className="data">
              <tbody>
                {Object.entries(ref?.functions ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <code>{k}</code>
                    </td>
                    <td style={{ textAlign: 'left' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Triggers</h3>
            <div className="chips">
              {(ref?.triggers ?? []).map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Bet triggers take filters: <code>betWon:place:6</code>, <code>betLost:dontCome</code>, <code>betMoved:come</code>.
            </p>
            <h3 style={{ marginTop: 18 }}>Full reference</h3>
            <p className="hint">
              <code>docs/strategy-dsl.md</code> (also <code>bun run cli docs</code>)
            </p>
            <pre className="transcript" style={{ maxHeight: 400, fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
              {ref?.docs}
            </pre>
          </div>
        </div>
      )}

      {tab === 'form' && (
        <div className="grid side">
          <div>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Rules</h2>
              <span className="hint">evaluated top to bottom at every decision point</span>
              <span className="spacer" />
              <button
                onClick={() =>
                  update((d) => {
                    d.rules.push({ on: 'pointEstablished', do: [{ action: 'bet', type: 'place', numbers: [6, 8], amount: '2u' }] });
                  })
                }
              >
                + rule
              </button>
            </div>
            {doc.rules.map((r, i) => (
              <RuleEditor
                key={i}
                rule={r}
                index={i}
                total={doc.rules.length}
                triggers={ref?.triggers ?? []}
                betTypes={ref?.betTypes ?? ['pass', 'dontPass', 'come', 'dontCome', 'odds', 'place', 'buy', 'lay', 'field', 'hardway']}
                onChange={(nr: ERule) => update((d) => void (d.rules[i] = nr))}
                onMove={(dir) =>
                  update((d) => {
                    const j = i + dir;
                    if (j < 0 || j >= d.rules.length) return;
                    [d.rules[i], d.rules[j]] = [d.rules[j]!, d.rules[i]!];
                  })
                }
                onRemove={() => update((d) => void d.rules.splice(i, 1))}
                onDuplicate={() => update((d) => void d.rules.splice(i + 1, 0, structuredClone(d.rules[i]!)))}
              />
            ))}
            <datalist id="number-groups">
              <option value="inside" />
              <option value="outside" />
              <option value="across" />
              <option value="6,8" />
            </datalist>
            <datalist id="selector-hints">
              {['self', 'all', 'inside', 'outside', 'across', 'props', 'removable', 'place', 'place:6', 'place:8', 'hardway', 'odds:come', 'dontCome', 'field'].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div>
            <div className="card">
              <h3>About</h3>
              <Field label="name">
                <TextInput value={doc.name} onChange={(v) => setKey('name', v ?? '')} />
              </Field>
              <Field label="id (file name)" hint={id ? 'changing it renames the file' : 'auto from the name if left empty'}>
                <TextInput mono value={doc.id} onChange={(v) => setKey('id', v ?? '')} />
              </Field>
              <Field label="description">
                <textarea rows={3} value={doc.description ?? ''} onChange={(e) => setKey('description', e.target.value)} />
              </Field>
              <Field label="tags (comma separated)">
                <TextInput
                  value={(doc.tags ?? []).join(', ')}
                  onChange={(v) =>
                    setKey(
                      'tags',
                      (v ?? '')
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
              {doc.source && (
                <div className="hint" style={{ marginTop: 6 }}>
                  source: {String(doc.source.type)}
                  {typeof doc.source.url === 'string' && (
                    <>
                      {' '}
                      <a href={doc.source.url} target="_blank" rel="noreferrer">
                        {String(doc.source.title ?? doc.source.url)}
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="card">
              <h3>Money</h3>
              <div className="row">
                <Field label="unit ($)" hint='"1u" in amounts'>
                  <NumberInput value={doc.unit} onChange={(v) => setKey('unit', v)} min={1} />
                </Field>
                <Field label="buy-in ($)">
                  <NumberInput value={doc.bankroll} onChange={(v) => setKey('bankroll', v)} min={1} />
                </Field>
              </div>
              <div className="row">
                <Field label="table min">
                  <NumberInput value={table.minBet as number} onChange={(v) => setNested('table', 'minBet', v)} />
                </Field>
                <Field label="odds policy">
                  <Select value={table.oddsPolicy as (typeof ODDS)[number]} options={ODDS} allowEmpty="3-4-5x" onChange={(v) => setNested('table', 'oddsPolicy', v)} />
                </Field>
                <Field label="rounding">
                  <Select value={doc.rounding as (typeof ROUNDING)[number]} options={ROUNDING} allowEmpty="up" onChange={(v) => setKey('rounding', v)} />
                </Field>
              </div>
              <div className="row">
                <Field label="stop loss">
                  <NumberInput value={exit.stopLoss as number} onChange={(v) => setNested('exit', 'stopLoss', v)} />
                </Field>
                <Field label="win goal">
                  <NumberInput value={exit.winGoal as number} onChange={(v) => setNested('exit', 'winGoal', v)} />
                </Field>
                <Field label="max shooters">
                  <NumberInput value={exit.maxShooters as number} onChange={(v) => setNested('exit', 'maxShooters', v)} />
                </Field>
              </div>
            </div>

            <div className="card">
              <h3>Variables</h3>
              {vars.map(([k, v], i) => (
                <div key={i} className="kv">
                  <input
                    type="text"
                    className="mono"
                    value={k}
                    onChange={(e) =>
                      update((d) => {
                        const entries = Object.entries(d.variables ?? {});
                        entries[i] = [e.target.value, v];
                        d.variables = Object.fromEntries(entries);
                      })
                    }
                  />
                  <input
                    type="text"
                    className="mono"
                    value={String(v)}
                    onChange={(e) =>
                      update((d) => {
                        const raw = e.target.value;
                        const val = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
                        d.variables = { ...(d.variables ?? {}), [k]: val };
                      })
                    }
                  />
                  <button
                    className="icon danger"
                    onClick={() =>
                      update((d) => {
                        const next = { ...(d.variables ?? {}) };
                        delete next[k];
                        if (Object.keys(next).length) d.variables = next;
                        else delete d.variables;
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="ghost"
                onClick={() =>
                  update((d) => {
                    d.variables = { ...(d.variables ?? {}), [`var${vars.length + 1}`]: 0 };
                  })
                }
              >
                + variable
              </button>
            </div>

            {doc.notes && (
              <div className="card">
                <h3>Importer notes</h3>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                  {doc.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {playing && <PlayDrawer doc={doc} onClose={() => setPlaying(false)} />}
    </>
  );
}
