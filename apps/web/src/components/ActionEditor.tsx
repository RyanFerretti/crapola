import type { EAction } from '../api.ts';
import { Field, NumberInput, Select, TextInput } from './ui.tsx';

export const ACTION_TYPES = ['bet', 'press', 'regress', 'takeDown', 'setWorking', 'set', 'increment', 'sitOut', 'walkAway', 'log'] as const;
const BOX = ['4', '5', '6', '8', '9', '10'] as const;
const ODDS_ON = ['pass', 'come', 'dontPass', 'dontCome'] as const;
const MODES = ['ensure', 'add', 'set'] as const;
const ROUNDING = ['up', 'down', 'nearest', 'none'] as const;
const WORKING = [
  { value: 'true', label: 'working (on)' },
  { value: 'false', label: 'off' },
] as const;

/** Amount-like fields accept a number or an expression string. */
function AmountInput({ value, onChange, placeholder }: { value: unknown; onChange: (v: string | number | undefined) => void; placeholder?: string }) {
  const str = value === undefined || value === null ? '' : String(value);
  return (
    <input
      type="text"
      className="mono"
      value={str}
      placeholder={placeholder ?? '12 or "2u"'}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') onChange(undefined);
        else if (/^-?\d+(\.\d+)?$/.test(v)) onChange(Number(v));
        else onChange(v);
      }}
    />
  );
}

function NumbersInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const str = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  return (
    <input
      type="text"
      className="mono"
      list="number-groups"
      value={str}
      placeholder="6,8 or inside"
      onChange={(e) => {
        const v = e.target.value.trim();
        if (!v) onChange(undefined);
        else if (['inside', 'outside', 'across'].includes(v)) onChange(v);
        else onChange(v.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)));
      }}
    />
  );
}

function TargetInput({ value, onChange }: { value: unknown; onChange: (v: string | undefined) => void }) {
  const str = typeof value === 'string' ? value : value ? JSON.stringify(value) : '';
  return <TextInput mono value={str} onChange={onChange} placeholder="self, place:6, inside, all" list="selector-hints" />;
}

export function ActionEditor({ action, betTypes, onChange }: { action: EAction; betTypes: string[]; onChange: (a: EAction) => void }) {
  const set = (k: string, v: unknown) => {
    const next = { ...action };
    if (v === undefined || v === '' || v === null) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const type = action.action;

  return (
    <div className="fields">
      <Field label="action">
        <Select
          value={type}
          options={ACTION_TYPES}
          onChange={(v) => {
            if (!v) return;
            const base: EAction = { action: v };
            if (v === 'bet') Object.assign(base, { type: 'pass', amount: '1u' });
            if (v === 'press' || v === 'takeDown' || v === 'setWorking') base.target = 'self';
            if (v === 'regress') Object.assign(base, { target: 'inside', to: '1u' });
            if (v === 'setWorking') base.working = true;
            if (v === 'set') Object.assign(base, { var: 'level', value: 1 });
            if (v === 'increment') base.var = 'level';
            if (v === 'sitOut') base.until = 'nextShooter';
            if (v === 'log') base.message = '';
            onChange(base);
          }}
        />
      </Field>

      {type === 'bet' && (
        <>
          <Field label="bet type">
            <Select value={action.type as string} options={betTypes} onChange={(v) => set('type', v)} />
          </Field>
          {action.type === 'odds' && (
            <Field label="on">
              <Select value={action.on as string} options={ODDS_ON} allowEmpty="(choose)" onChange={(v) => set('on', v)} />
            </Field>
          )}
          {['place', 'buy', 'lay', 'hardway', 'odds'].includes(String(action.type)) && (
            <>
              <Field label="number">
                <Select value={action.number === undefined ? undefined : String(action.number)} options={BOX} allowEmpty="—" onChange={(v) => set('number', v ? Number(v) : undefined)} />
              </Field>
              <Field label="numbers">
                <NumbersInput value={action.numbers} onChange={(v) => set('numbers', v)} />
              </Field>
              {action.type !== 'odds' && (
                <Field label="skip point">
                  <input type="checkbox" checked={Boolean(action.skipPoint)} onChange={(e) => set('skipPoint', e.target.checked || undefined)} />
                </Field>
              )}
            </>
          )}
          {action.type === 'hop' && (
            <Field label="hop dice">
              <input
                type="text"
                className="mono"
                value={Array.isArray(action.hop) ? (action.hop as number[]).join('-') : ''}
                placeholder="3-4"
                onChange={(e) => {
                  const m = e.target.value.match(/^([1-6])\D([1-6])$/);
                  set('hop', m ? [Number(m[1]), Number(m[2])] : undefined);
                }}
              />
            </Field>
          )}
          {action.type === 'odds' ? (
            <>
              <Field label="max odds">
                <input type="checkbox" checked={Boolean(action.max)} onChange={(e) => set('max', e.target.checked || undefined)} />
              </Field>
              <Field label="multiple">
                <AmountInput value={action.multiple} onChange={(v) => set('multiple', v)} placeholder="2" />
              </Field>
              <Field label="amount">
                <AmountInput value={action.amount} onChange={(v) => set('amount', v)} />
              </Field>
            </>
          ) : (
            <Field label="amount">
              <AmountInput value={action.amount} onChange={(v) => set('amount', v)} />
            </Field>
          )}
          <Field label="mode">
            <Select value={(action.mode as string) ?? 'ensure'} options={MODES} onChange={(v) => set('mode', v === 'ensure' ? undefined : v)} />
          </Field>
          <Field label="working">
            <Select
              value={action.working === undefined ? undefined : String(action.working)}
              options={WORKING}
              allowEmpty="table default"
              onChange={(v) => set('working', v === undefined ? undefined : v === 'true')}
            />
          </Field>
          <Field label="rounding">
            <Select value={action.rounding as string} options={ROUNDING} allowEmpty="doc default" onChange={(v) => set('rounding', v)} />
          </Field>
          <Field label="max amount">
            <AmountInput value={action.maxAmount} onChange={(v) => set('maxAmount', v)} placeholder="cap" />
          </Field>
          <Field label="tag">
            <TextInput value={action.tag as string} onChange={(v) => set('tag', v)} placeholder="optional" />
          </Field>
        </>
      )}

      {type === 'press' && (
        <>
          <Field label="target" className="wide">
            <TargetInput value={action.target} onChange={(v) => set('target', v)} />
          </Field>
          <Field label="by">
            <AmountInput value={action.by} onChange={(v) => set('by', v)} placeholder="winnings | half | full | 12" />
          </Field>
          <Field label="max">
            <AmountInput value={action.max} onChange={(v) => set('max', v)} placeholder="cap" />
          </Field>
          <Field label="rounding">
            <Select value={action.rounding as string} options={ROUNDING} allowEmpty="down" onChange={(v) => set('rounding', v)} />
          </Field>
        </>
      )}

      {type === 'regress' && (
        <>
          <Field label="target" className="wide">
            <TargetInput value={action.target} onChange={(v) => set('target', v)} />
          </Field>
          <Field label="to">
            <AmountInput value={action.to} onChange={(v) => set('to', v)} />
          </Field>
          <Field label="rounding">
            <Select value={action.rounding as string} options={ROUNDING} allowEmpty="doc default" onChange={(v) => set('rounding', v)} />
          </Field>
        </>
      )}

      {type === 'takeDown' && (
        <Field label="target" className="wide">
          <TargetInput value={action.target} onChange={(v) => set('target', v)} />
        </Field>
      )}

      {type === 'setWorking' && (
        <>
          <Field label="target" className="wide">
            <TargetInput value={action.target} onChange={(v) => set('target', v)} />
          </Field>
          <Field label="working">
            <Select
              value={action.working === null ? 'default' : action.working === undefined ? 'true' : String(action.working)}
              options={[
                { value: 'true', label: 'on' },
                { value: 'false', label: 'off' },
                { value: 'default', label: 'table default' },
              ]}
              onChange={(v) => onChange({ ...action, working: v === 'default' ? null : v === 'true' })}
            />
          </Field>
        </>
      )}

      {(type === 'set' || type === 'increment') && (
        <>
          <Field label="variable">
            <TextInput mono value={action.var as string} onChange={(v) => set('var', v)} placeholder="level" />
          </Field>
          {type === 'set' ? (
            <Field label="value" className="wide">
              <AmountInput value={action.value} onChange={(v) => set('value', v)} placeholder='1 or "remainder > 0 ? 2 : 1"' />
            </Field>
          ) : (
            <Field label="by">
              <AmountInput value={action.by} onChange={(v) => set('by', v)} placeholder="1" />
            </Field>
          )}
        </>
      )}

      {type === 'sitOut' && (
        <>
          <Field label="until">
            <Select value={action.until as string} options={['nextShooter', 'pointEstablished', 'pointOff', 'rolls'] as const} onChange={(v) => set('until', v)} />
          </Field>
          {action.until === 'rolls' && (
            <Field label="rolls">
              <NumberInput value={action.rolls as number} onChange={(v) => set('rolls', v)} min={1} />
            </Field>
          )}
        </>
      )}

      {type === 'walkAway' && (
        <Field label="mode">
          <Select value={action.mode as string} options={['takeDown', 'rideOut'] as const} allowEmpty="takeDown" onChange={(v) => set('mode', v)} />
        </Field>
      )}

      {type === 'log' && (
        <Field label="message" className="wide">
          <TextInput value={action.message as string} onChange={(v) => set('message', v ?? '')} placeholder="pressing to {betAmount('place', 6)}" />
        </Field>
      )}

      <Field label="note" className="wide">
        <TextInput value={action.description as string} onChange={(v) => set('description', v)} placeholder="optional" />
      </Field>
    </div>
  );
}
