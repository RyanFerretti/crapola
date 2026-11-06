import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { type Strategy, type StrategyDoc, type ValidationIssue, compileStrategy, validateStrategyDoc } from '@crapola/engine';

export interface LibraryEntry {
  id: string;
  file: string;
  doc: StrategyDoc | null;
  /** The file's JSON as written, for repairing invalid documents. */
  raw: unknown;
  issues: ValidationIssue[];
  warnings: string[];
}

/** Strategy files on disk: one JSON document per strategy in `strategies/`. */
export class StrategyLibrary {
  readonly dir: string;

  constructor(dir = 'strategies') {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  files(): string[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => join(this.dir, f));
  }

  list(): LibraryEntry[] {
    return this.files().map((file) => this.read(file));
  }

  read(file: string): LibraryEntry {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      return { id: basename(file, '.json'), file, doc: null, raw: null, issues: [{ path: '(file)', message: `invalid JSON: ${(e as Error).message}` }], warnings: [] };
    }
    const v = validateStrategyDoc(raw);
    if (!v.ok) return { id: (raw as { id?: string })?.id ?? basename(file, '.json'), file, doc: null, raw, issues: v.issues, warnings: [] };
    return { id: v.doc.id, file, doc: v.doc, raw, issues: [], warnings: v.warnings };
  }

  pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Resolve an id or a file path to a compiled strategy. */
  load(idOrPath: string): { strategy: Strategy; doc: StrategyDoc; file: string; warnings: string[] } {
    const file = existsSync(idOrPath) && idOrPath.endsWith('.json') ? resolve(idOrPath) : this.pathFor(idOrPath);
    if (!existsSync(file)) throw new Error(`No strategy "${idOrPath}" (looked for ${file})`);
    const entry = this.read(file);
    if (!entry.doc) throw new Error(`Strategy ${idOrPath} is invalid:\n${entry.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
    return { strategy: compileStrategy(entry.doc), doc: entry.doc, file, warnings: entry.warnings };
  }

  get(id: string): LibraryEntry | null {
    const file = this.pathFor(id);
    return existsSync(file) ? this.read(file) : null;
  }

  /** Validate and write a strategy. Returns issues instead of writing when invalid. */
  save(raw: unknown): { ok: true; doc: StrategyDoc; file: string; warnings: string[] } | { ok: false; issues: ValidationIssue[] } {
    const v = validateStrategyDoc(raw);
    if (!v.ok) return v;
    const file = this.pathFor(v.doc.id);
    writeFileSync(file, `${JSON.stringify(v.doc, null, 2)}\n`);
    return { ok: true, doc: v.doc, file, warnings: v.warnings };
  }

  delete(id: string): boolean {
    const file = this.pathFor(id);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }
}
