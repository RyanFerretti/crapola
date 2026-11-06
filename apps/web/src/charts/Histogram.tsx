import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, money } from '../format.ts';
import type { ChartTheme } from '../theme.ts';

export interface HistogramData {
  binStart: number;
  binWidth: number;
  counts: number[];
}

/** Profit distribution for one strategy. One series, so no legend; title carries the identity. */
export function Histogram({ hist, color, mean, sessions, theme, height = 170 }: { hist: HistogramData; color: string; mean: number; sessions: number; theme: ChartTheme; height?: number }) {
  const data = hist.counts.map((c, i) => ({ x: hist.binStart + i * hist.binWidth, c }));
  if (data.length === 0) return null;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <XAxis dataKey="x" tick={{ fontSize: 10, fill: theme.muted }} stroke={theme.grid} tickLine={false} tickFormatter={(v: number) => compact(v)} minTickGap={24} />
          <YAxis tick={{ fontSize: 10, fill: theme.muted }} stroke={theme.grid} tickLine={false} width={36} tickFormatter={(v: number) => compact(v)} />
          <ReferenceLine x={0} stroke={theme.text} strokeWidth={1} ifOverflow="extendDomain" />
          <ReferenceLine x={Math.round(mean / hist.binWidth) * hist.binWidth} stroke={theme.amber} strokeWidth={2} />
          <Tooltip
            cursor={{ fill: theme.grid, opacity: 0.4 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="tip">
                  <span className="num">
                    {money(payload[0]!.payload.x)} to {money(payload[0]!.payload.x + hist.binWidth)}
                  </span>
                  <span className="num">
                    {payload[0]!.payload.c.toLocaleString()} sessions ({((100 * payload[0]!.payload.c) / sessions).toFixed(1)}%)
                  </span>
                </div>
              ) : null
            }
          />
          <Bar dataKey="c" isAnimationActive={false} radius={[3, 3, 0, 0]} maxBarSize={24}>
            {data.map((d, i) => (
              <Cell key={i} fill={color} fillOpacity={d.x + hist.binWidth <= 0 ? 0.55 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
