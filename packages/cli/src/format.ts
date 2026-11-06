import type { StrategySummary } from '@crapola/engine';

export function money(n: number, digits = 0): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function table(rows: string[][], align: Array<'l' | 'r'> = []): string {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  return rows
    .map((r) => r.map((c, i) => ((align[i] ?? 'l') === 'r' ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join('  ').trimEnd())
    .join('\n');
}

export function summaryTable(summaries: StrategySummary[]): string {
  const header = ['strategy', 'mean', 'median', 'stdev', 'p5', 'p95', 'win%', 'bust%', '$/roll', 'rolls', 'wagered', 'edge', 'maxDD'];
  const rows = summaries.map((s) => [
    s.strategyId,
    money(s.mean, 2),
    money(s.median),
    money(s.stdev),
    money(s.p5),
    money(s.p95),
    pct(s.winRate),
    pct(s.bustRate),
    money(s.profitPerRoll, 3),
    s.meanRolls.toFixed(0),
    money(s.meanWagered),
    pct(s.edge, 2),
    money(s.meanMaxDrawdown),
  ]);
  return table([header, ...rows], ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
}

export function sparkline(hist: { counts: number[] }): string {
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(1, ...hist.counts);
  return hist.counts.map((c) => (c === 0 ? ' ' : bars[Math.min(7, Math.floor((c / max) * 8))])).join('');
}
