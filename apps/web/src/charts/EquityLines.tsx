import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, money } from '../format.ts';
import type { ChartTheme } from '../theme.ts';

export interface SeriesGroup {
  id: string;
  name: string;
  color: string;
  series: number[][];
}

/** Equity after every roll for a sample of sessions, per strategy. */
export function EquityLines({ groups, startBankroll, theme, height = 280 }: { groups: SeriesGroup[]; startBankroll: number; theme: ChartTheme; height?: number }) {
  const maxLen = Math.max(0, ...groups.flatMap((g) => g.series.map((s) => s.length)));
  if (maxLen === 0) return <div className="hint">No sampled sessions in this run.</div>;
  const rows: Array<Record<string, number>> = [];
  for (let i = 0; i < maxLen; i++) {
    const row: Record<string, number> = { i };
    groups.forEach((g, gi) => g.series.forEach((s, si) => {
      if (s[i] !== undefined) row[`g${gi}s${si}`] = s[i]!;
    }));
    rows.push(row);
  }
  return (
    <>
      <div className="legend">
        {groups.map((g) => (
          <span key={g.id}>
            <i className="swatch" style={{ background: g.color }} /> {g.name}
          </span>
        ))}
        <span className="muted">{groups[0]?.series.length ?? 0} sampled sessions each</span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
            <XAxis
              dataKey="i"
              type="number"
              domain={[0, maxLen - 1]}
              tick={{ fontSize: 10, fill: theme.muted }}
              stroke={theme.grid}
              tickLine={false}
              tickCount={8}
              label={{ value: 'rolls into the session', position: 'insideBottom', offset: -10, fill: theme.muted, fontSize: 10 }}
            />
            <YAxis tick={{ fontSize: 10, fill: theme.muted }} stroke={theme.grid} tickLine={false} width={44} tickFormatter={(v: number) => compact(v)} domain={['auto', 'auto']} />
            <ReferenceLine y={startBankroll} stroke={theme.text} strokeWidth={1} />
            <Tooltip
              content={({ active, label }) =>
                active ? (
                  <div className="tip">
                    roll {label}
                    <span className="num muted">start {money(startBankroll)}</span>
                  </div>
                ) : null
              }
            />
            {groups.flatMap((g, gi) =>
              g.series.map((_, si) => (
                <Line key={`g${gi}s${si}`} dataKey={`g${gi}s${si}`} stroke={g.color} strokeWidth={1.25} strokeOpacity={0.45} dot={false} isAnimationActive={false} connectNulls={false} type="linear" />
              )),
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
