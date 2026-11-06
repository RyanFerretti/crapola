import type { ReactNode } from 'react';
import { money } from '../format.ts';

export function Money({ value, digits = 0, signed = true }: { value: number; digits?: number; signed?: boolean }) {
  const cls = signed ? (value > 0 ? 'num pos' : value < 0 ? 'num neg' : 'num') : 'num';
  return <span className={cls}>{signed && value > 0 ? `+${money(value, digits)}` : money(value, digits)}</span>;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  step,
  min,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  step?: number;
  min?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      step={step}
      min={min}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  list,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  mono?: boolean;
  list?: string;
}) {
  return (
    <input
      type="text"
      className={mono ? 'mono' : undefined}
      value={value ?? ''}
      placeholder={placeholder}
      list={list}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  allowEmpty,
}: {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: ReadonlyArray<T | { value: T; label: string }>;
  allowEmpty?: string;
}) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : (e.target.value as T))}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Issues({ issues, warnings, okText }: { issues: Array<{ path: string; message: string }>; warnings?: string[]; okText?: string }) {
  if (issues.length === 0 && (!warnings || warnings.length === 0)) return okText ? <div className="issues ok">{okText}</div> : null;
  return (
    <>
      {issues.length > 0 && (
        <div className="issues">
          <strong>{issues.length} problem{issues.length === 1 ? '' : 's'}</strong>
          <ul>
            {issues.map((i, k) => (
              <li key={k}>
                <code>{i.path}</code> {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="issues warn">
          <ul>
            {warnings.map((w, k) => (
              <li key={k}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function PageHead({ eyebrow, title, blurb, actions }: { eyebrow?: string; title: string; blurb?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {blurb && <p>{blurb}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
