import type { ChartTheme } from '../theme.ts';

const LABELS: Record<string, string> = {
  maxShooters: 'played all shooters',
  maxRolls: 'roll cap',
  winGoal: 'hit win goal',
  stopLoss: 'hit stop loss',
  busted: 'busted',
  walkedAway: 'walked away',
  diceExhausted: 'dice ran out',
};
const ORDER = ['winGoal', 'maxShooters', 'maxRolls', 'walkedAway', 'stopLoss', 'busted', 'diceExhausted'];

/** How sessions ended, as a 100% bar per strategy. */
export function EndReasons({ rows, theme }: { rows: Array<{ id: string; name: string; reasons: Record<string, number>; total: number }>; theme: ChartTheme }) {
  const present = ORDER.filter((r) => rows.some((row) => (row.reasons[r] ?? 0) > 0));
  return (
    <div>
      <div className="legend">
        {present.map((r) => (
          <span key={r}>
            <i className="swatch" style={{ background: theme.reasons[r] ?? theme.muted }} /> {LABELS[r] ?? r}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.id} style={{ marginBottom: 8 }}>
          <div className="small" style={{ marginBottom: 3 }}>
            {row.name}
          </div>
          <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', gap: 2, background: theme.surface }} title={present.map((r) => `${LABELS[r] ?? r}: ${(((row.reasons[r] ?? 0) / row.total) * 100).toFixed(1)}%`).join('\n')}>
            {present.map((r) => {
              const share = (row.reasons[r] ?? 0) / row.total;
              if (share === 0) return null;
              return (
                <div key={r} style={{ width: `${share * 100}%`, background: theme.reasons[r] ?? theme.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                  {share >= 0.12 ? `${Math.round(share * 100)}%` : ''}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
