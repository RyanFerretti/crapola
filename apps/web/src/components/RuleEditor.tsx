import { useState } from 'react';
import type { EAction, ERule } from '../api.ts';
import { ActionEditor } from './ActionEditor.tsx';
import { Field, Select, TextInput } from './ui.tsx';

const ONCE = ['shooter', 'point', 'session', 'roll'] as const;

function Chips({ value, onChange, vocabulary }: { value: string[]; onChange: (v: string[]) => void; vocabulary: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (t: string) => {
    const v = t.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="chips">
      {value.map((t) => (
        <span key={t} className="chip">
          {t}
          <button type="button" title="remove" onClick={() => onChange(value.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="mono"
        list="trigger-vocab"
        style={{ width: 190 }}
        placeholder={value.length ? 'add trigger…' : 'every roll (add a trigger)'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
      />
      <datalist id="trigger-vocab">
        {vocabulary.map((v) => (
          <option key={v} value={v} />
        ))}
        <option value="betWon:place" />
        <option value="betWon:place:6" />
        <option value="betLost:dontPass" />
        <option value="betMoved:come" />
      </datalist>
    </div>
  );
}

export function RuleEditor({
  rule,
  index,
  total,
  triggers,
  betTypes,
  onChange,
  onMove,
  onRemove,
  onDuplicate,
}: {
  rule: ERule;
  index: number;
  total: number;
  triggers: string[];
  betTypes: string[];
  onChange: (r: ERule) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const on = rule.on === undefined ? [] : Array.isArray(rule.on) ? rule.on : [rule.on];
  const set = (k: keyof ERule, v: unknown) => {
    const next = { ...rule } as Record<string, unknown>;
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
    onChange(next as unknown as ERule);
  };
  const setAction = (i: number, a: EAction) => onChange({ ...rule, do: rule.do.map((x, k) => (k === i ? a : x)) });
  const moveAction = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rule.do.length) return;
    const next = [...rule.do];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange({ ...rule, do: next });
  };

  return (
    <div className={`rule ${rule.enabled === false ? 'disabled' : ''}`}>
      <div className="rule-head">
        <span className="idx">{index + 1}.</span>
        <input type="text" className="rule-id" placeholder="rule id (optional)" value={rule.id ?? ''} onChange={(e) => set('id', e.target.value)} />
        <input type="text" style={{ flex: 2 }} placeholder="what this rule does, in words" value={rule.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={rule.enabled !== false} onChange={(e) => set('enabled', e.target.checked ? undefined : false)} /> on
        </label>
        <span className="ctl" style={{ display: 'flex', gap: 2 }}>
          <button type="button" className="icon" title="move up" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="icon" title="move down" disabled={index === total - 1} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="icon" title="duplicate" onClick={onDuplicate}>
            ⧉
          </button>
          <button type="button" className="icon danger" title="remove rule" onClick={onRemove}>
            ×
          </button>
        </span>
      </div>
      <div className="row">
        <Field label="when (triggers)" className="grow">
          <Chips value={on} onChange={(v) => set('on', v.length === 1 ? v[0] : v)} vocabulary={triggers} />
        </Field>
        <Field label="and (condition)" className="grow">
          <TextInput mono value={rule.when} onChange={(v) => set('when', v)} placeholder="pointOn && !hasBet('place', 6)" />
        </Field>
        <Field label="once per">
          <Select value={rule.once as (typeof ONCE)[number]} options={ONCE} allowEmpty="every time" onChange={(v) => set('once', v)} />
        </Field>
      </div>
      {rule.do.map((a, i) => (
        <div key={i} className="action">
          <span className="no">{i + 1}</span>
          <ActionEditor action={a} betTypes={betTypes} onChange={(x) => setAction(i, x)} />
          <span className="ctl">
            <button type="button" className="icon" disabled={i === 0} onClick={() => moveAction(i, -1)} title="move up">
              ↑
            </button>
            <button type="button" className="icon" disabled={i === rule.do.length - 1} onClick={() => moveAction(i, 1)} title="move down">
              ↓
            </button>
            <button type="button" className="icon danger" disabled={rule.do.length === 1} onClick={() => onChange({ ...rule, do: rule.do.filter((_, k) => k !== i) })} title="remove action">
              ×
            </button>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        <button type="button" className="ghost" onClick={() => onChange({ ...rule, do: [...rule.do, { action: 'bet', type: 'place', numbers: [6, 8], amount: '2u' }] })}>
          + action
        </button>
      </div>
    </div>
  );
}
