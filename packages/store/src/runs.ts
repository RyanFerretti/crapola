import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BatchConfig, SessionResult, StrategyDoc, StrategySummary } from '@crapola/engine';

export interface SavedStrategyRun {
  strategyId: string;
  doc: StrategyDoc | null;
  summary: StrategySummary;
  results: SessionResult[];
  /** Equity series for a handful of sessions, for charts. */
  series: number[][];
  elapsedMs: number;
}

export interface RunRecord {
  id: number;
  createdAt: string;
  name: string | null;
  config: Omit<BatchConfig, 'onProgress'>;
  strategies: SavedStrategyRun[];
}

export interface RunListItem {
  id: number;
  createdAt: string;
  name: string | null;
  sessions: number;
  bankroll: number;
  strategyIds: string[];
  means: Record<string, number>;
}

export class RunStore {
  readonly db: Database;

  constructor(path = 'data/crapola.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        name TEXT,
        config TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        strategy_id TEXT NOT NULL,
        doc TEXT,
        summary TEXT NOT NULL,
        results TEXT NOT NULL,
        series TEXT NOT NULL,
        elapsed_ms REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_strategies_run ON run_strategies(run_id);
    `);
  }

  saveRun(config: Omit<BatchConfig, 'onProgress'>, strategies: SavedStrategyRun[], name?: string): number {
    const insertRun = this.db.prepare('INSERT INTO runs (created_at, name, config) VALUES (?, ?, ?)');
    const insertStrat = this.db.prepare(
      'INSERT INTO run_strategies (run_id, strategy_id, doc, summary, results, series, elapsed_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const tx = this.db.transaction(() => {
      const res = insertRun.run(new Date().toISOString(), name ?? null, JSON.stringify(config));
      const runId = Number(res.lastInsertRowid);
      for (const s of strategies) {
        insertStrat.run(
          runId,
          s.strategyId,
          s.doc ? JSON.stringify(s.doc) : null,
          JSON.stringify(s.summary),
          JSON.stringify(s.results.map(({ series, log, ...r }) => r)),
          JSON.stringify(s.series),
          s.elapsedMs,
        );
      }
      return runId;
    });
    return tx();
  }

  listRuns(limit = 50): RunListItem[] {
    const rows = this.db
      .prepare('SELECT id, created_at, name, config FROM runs ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ id: number; created_at: string; name: string | null; config: string }>;
    const strats = this.db.prepare('SELECT strategy_id, summary FROM run_strategies WHERE run_id = ? ORDER BY id');
    return rows.map((r) => {
      const config = JSON.parse(r.config) as BatchConfig;
      const ss = strats.all(r.id) as Array<{ strategy_id: string; summary: string }>;
      const means: Record<string, number> = {};
      for (const s of ss) means[s.strategy_id] = (JSON.parse(s.summary) as StrategySummary).mean;
      return {
        id: r.id,
        createdAt: r.created_at,
        name: r.name,
        sessions: config.sessions,
        bankroll: config.bankroll,
        strategyIds: ss.map((s) => s.strategy_id),
        means,
      };
    });
  }

  getRun(id: number, { includeResults = true } = {}): RunRecord | null {
    const r = this.db.prepare('SELECT id, created_at, name, config FROM runs WHERE id = ?').get(id) as
      | { id: number; created_at: string; name: string | null; config: string }
      | undefined;
    if (!r) return null;
    const rows = this.db
      .prepare('SELECT strategy_id, doc, summary, results, series, elapsed_ms FROM run_strategies WHERE run_id = ? ORDER BY id')
      .all(id) as Array<{ strategy_id: string; doc: string | null; summary: string; results: string; series: string; elapsed_ms: number }>;
    return {
      id: r.id,
      createdAt: r.created_at,
      name: r.name,
      config: JSON.parse(r.config),
      strategies: rows.map((s) => ({
        strategyId: s.strategy_id,
        doc: s.doc ? JSON.parse(s.doc) : null,
        summary: JSON.parse(s.summary),
        results: includeResults ? JSON.parse(s.results) : [],
        series: JSON.parse(s.series),
        elapsedMs: s.elapsed_ms,
      })),
    };
  }

  deleteRun(id: number): boolean {
    this.db.prepare('DELETE FROM run_strategies WHERE run_id = ?').run(id);
    const res = this.db.prepare('DELETE FROM runs WHERE id = ?').run(id);
    return res.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
