import type { SessionResult } from './session.ts';

export interface Histogram {
  binStart: number;
  binWidth: number;
  counts: number[];
}

export interface StrategySummary {
  strategyId: string;
  sessions: number;
  startBankroll: number;
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  /** Share of sessions that ended ahead. */
  winRate: number;
  /** Share of sessions that ended broke. */
  bustRate: number;
  winGoalRate: number;
  stopLossRate: number;
  meanRolls: number;
  meanShooters: number;
  profitPerRoll: number;
  profitPerShooter: number;
  meanWagered: number;
  /** Mean loss per dollar wagered (positive = house edge). */
  edge: number;
  meanMaxDrawdown: number;
  worstDrawdown: number;
  meanPeak: number;
  rejectedBets: number;
  /** Expected shortfall: mean of the worst 5% of sessions. */
  cvar5: number;
  histogram: Histogram;
  endReasons: Record<string, number>;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[], m = mean(xs)): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function histogram(xs: number[], bins = 40): Histogram {
  if (xs.length === 0) return { binStart: 0, binWidth: 1, counts: [] };
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const rawWidth = (hi - lo) / bins;
  // Snap bin width to a tidy number.
  const mag = 10 ** Math.floor(Math.log10(rawWidth));
  const width = [1, 2, 5, 10].map((k) => k * mag).find((w) => w >= rawWidth) ?? rawWidth;
  const start = Math.floor(lo / width) * width;
  const n = Math.max(1, Math.ceil((hi - start) / width) + 1);
  const counts = new Array(n).fill(0);
  for (const x of xs) {
    const i = Math.min(n - 1, Math.floor((x - start) / width));
    counts[i]++;
  }
  return { binStart: start, binWidth: width, counts };
}

export function summarize(strategyId: string, results: SessionResult[]): StrategySummary {
  const profits = results.map((r) => r.profit);
  const sorted = [...profits].sort((a, b) => a - b);
  const m = mean(profits);
  const rolls = results.reduce((s, r) => s + r.rolls, 0);
  const shooters = results.reduce((s, r) => s + r.shooters, 0);
  const wagered = results.reduce((s, r) => s + r.totalWagered, 0);
  const total = profits.reduce((a, b) => a + b, 0);
  const tail = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)));
  const endReasons: Record<string, number> = {};
  for (const r of results) endReasons[r.endReason] = (endReasons[r.endReason] ?? 0) + 1;
  return {
    strategyId,
    sessions: results.length,
    startBankroll: results[0]?.startBankroll ?? 0,
    mean: m,
    median: quantile(sorted, 0.5),
    stdev: stdev(profits, m),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p5: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    winRate: results.length ? results.filter((r) => r.profit > 0).length / results.length : 0,
    bustRate: results.length ? results.filter((r) => r.endReason === 'busted').length / results.length : 0,
    winGoalRate: results.length ? results.filter((r) => r.endReason === 'winGoal').length / results.length : 0,
    stopLossRate: results.length ? results.filter((r) => r.endReason === 'stopLoss').length / results.length : 0,
    meanRolls: results.length ? rolls / results.length : 0,
    meanShooters: results.length ? shooters / results.length : 0,
    profitPerRoll: rolls ? total / rolls : 0,
    profitPerShooter: shooters ? total / shooters : 0,
    meanWagered: results.length ? wagered / results.length : 0,
    edge: wagered ? -total / wagered : 0,
    meanMaxDrawdown: mean(results.map((r) => r.maxDrawdown)),
    worstDrawdown: Math.max(0, ...results.map((r) => r.maxDrawdown)),
    meanPeak: mean(results.map((r) => r.peakEquity - r.startBankroll)),
    rejectedBets: results.reduce((s, r) => s + r.rejectedBets, 0),
    cvar5: mean(tail),
    histogram: histogram(profits),
    endReasons,
  };
}

/** How often strategy A out-earned strategy B on the same dice. */
export function headToHead(a: SessionResult[], b: SessionResult[]): { aWins: number; bWins: number; ties: number } {
  const bySeed = new Map(b.map((r) => [r.seed, r]));
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const ra of a) {
    const rb = bySeed.get(ra.seed);
    if (!rb) continue;
    if (ra.profit > rb.profit) aWins++;
    else if (rb.profit > ra.profit) bWins++;
    else ties++;
  }
  return { aWins, bWins, ties };
}
