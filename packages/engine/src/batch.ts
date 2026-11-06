import { deriveSeed } from './rng.ts';
import { type RunConfig, type SessionResult, runSession } from './session.ts';
import { type StrategySummary, summarize } from './stats.ts';
import type { Strategy } from './strategy/types.ts';

export interface BatchConfig extends Omit<RunConfig, 'seed' | 'fixedRolls'> {
  sessions: number;
  /** Base seed; session i uses deriveSeed(seed, i) so every strategy sees the same dice. */
  seed?: number;
  /** Keep the equity series for the first N sessions (for charts). */
  seriesFor?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface BatchResult {
  strategyId: string;
  config: Omit<BatchConfig, 'onProgress'>;
  results: SessionResult[];
  summary: StrategySummary;
  elapsedMs: number;
}

export function runBatch(strategy: Strategy, config: BatchConfig): BatchResult {
  const { onProgress, ...rest } = config;
  const base = config.seed ?? 12345;
  const results: SessionResult[] = new Array(config.sessions);
  const t0 = performance.now();
  const step = Math.max(1, Math.floor(config.sessions / 50));
  for (let i = 0; i < config.sessions; i++) {
    results[i] = runSession(strategy, {
      ...rest,
      seed: deriveSeed(base, i),
      recordSeries: config.seriesFor !== undefined && i < config.seriesFor,
      recordLog: false,
    });
    if (onProgress && (i % step === 0 || i === config.sessions - 1)) onProgress(i + 1, config.sessions);
  }
  return {
    strategyId: strategy.id,
    config: rest,
    results,
    summary: summarize(strategy.id, results),
    elapsedMs: performance.now() - t0,
  };
}

/** Strip per-session series/logs for compact storage. */
export function compactResults(results: SessionResult[]): SessionResult[] {
  return results.map(({ series, log, ...r }) => r);
}
