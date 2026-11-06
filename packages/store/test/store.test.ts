import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch } from '@crapola/engine';
import { RunStore, StrategyLibrary } from '../src/index.ts';

const doc = {
  version: 1,
  id: 'pass',
  name: 'Pass',
  unit: 10,
  rules: [{ on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: '1u' }] }],
};

describe('StrategyLibrary', () => {
  test('save, list, load, delete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crapola-lib-'));
    try {
      const lib = new StrategyLibrary(dir);
      const saved = lib.save(doc);
      expect(saved.ok).toBe(true);
      expect(lib.list().map((e) => e.id)).toEqual(['pass']);
      const loaded = lib.load('pass');
      expect(loaded.strategy.id).toBe('pass');
      const bad = lib.save({ ...doc, id: 'bad', rules: [{ do: [{ action: 'bet', type: 'place', amount: 5 }] }] });
      expect(bad.ok).toBe(false);
      expect(lib.list().length).toBe(1);
      expect(lib.delete('pass')).toBe(true);
      expect(lib.list().length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('RunStore', () => {
  test('round-trips a run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crapola-lib-'));
    const lib = new StrategyLibrary(dir);
    lib.save(doc);
    const { strategy } = lib.load('pass');
    const config = { sessions: 50, bankroll: 300, maxShooters: 3, seed: 1, seriesFor: 2 };
    const batch = runBatch(strategy, config);
    const store = new RunStore(':memory:');
    const id = store.saveRun(
      config,
      [{ strategyId: 'pass', doc: lib.get('pass')!.doc, summary: batch.summary, results: batch.results, series: batch.results.slice(0, 2).map((r) => r.series ?? []), elapsedMs: 1 }],
      'test run',
    );
    const list = store.listRuns();
    expect(list.length).toBe(1);
    expect(list[0]!.strategyIds).toEqual(['pass']);
    expect(list[0]!.means.pass).toBeCloseTo(batch.summary.mean, 6);
    const run = store.getRun(id)!;
    expect(run.name).toBe('test run');
    expect(run.strategies[0]!.results.length).toBe(50);
    expect(run.strategies[0]!.series.length).toBe(2);
    expect(run.strategies[0]!.series[0]!.length).toBeGreaterThan(1);
    expect(run.strategies[0]!.results[0]!.series).toBeUndefined();
    expect(store.deleteRun(id)).toBe(true);
    expect(store.listRuns().length).toBe(0);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
