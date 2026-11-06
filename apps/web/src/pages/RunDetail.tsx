import { useEffect, useState } from 'react';
import { type RunDetail, api } from '../api.ts';
import { EndReasons } from '../charts/EndReasons.tsx';
import { EquityLines } from '../charts/EquityLines.tsx';
import { Histogram } from '../charts/Histogram.tsx';
import { Money, PageHead } from '../components/ui.tsx';
import { money, pct, when } from '../format.ts';
import { navigate } from '../router.ts';
import { seriesColor, useChartTheme } from '../theme.ts';

export function RunDetailPage({ id }: { id: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useChartTheme();

  useEffect(() => {
    api.run(id).then(setRun).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="issues">{error}</div>;
  if (!run) return <div className="muted">loading…</div>;

  const c = run.config;
  const configLine = [
    `${c.sessions.toLocaleString()} sessions`,
    `bankroll ${money(c.bankroll)}`,
    c.maxShooters ? `${c.maxShooters} shooters` : null,
    c.maxRolls ? `${c.maxRolls} rolls max` : null,
    c.stopLoss ? `stop loss ${money(c.stopLoss)}` : null,
    c.winGoal ? `win goal ${money(c.winGoal)}` : null,
    c.unit ? `unit $${c.unit}` : null,
    c.rules?.minBet ? `$${c.rules.minBet} table` : null,
    c.rules?.oddsPolicy ? `${c.rules.oddsPolicy} odds` : null,
    `seed ${c.seed}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const remove = async () => {
    if (!confirm(`Delete run #${run.id}?`)) return;
    await api.deleteRun(run.id);
    navigate('/runs');
  };

  const best = [...run.strategies].sort((a, b) => b.summary.mean - a.summary.mean)[0];

  return (
    <>
      <PageHead
        eyebrow={`Run #${run.id} · ${when(run.createdAt)}`}
        title={run.name ?? run.strategies.map((s) => s.name).join(' vs ')}
        blurb={configLine}
        actions={
          <>
            <a className="btn" href={`#/run?from=${run.id}`}>
              Re-run with this config
            </a>
            <button className="danger" onClick={remove}>
              Delete
            </button>
          </>
        }
      />

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>strategy</th>
              <th>mean</th>
              <th>median</th>
              <th>stdev</th>
              <th>p5</th>
              <th>p95</th>
              <th>win rate</th>
              <th>bust</th>
              <th>$/roll</th>
              <th>rolls</th>
              <th>wagered</th>
              <th>edge</th>
              <th>avg max DD</th>
              <th>worst 5%</th>
            </tr>
          </thead>
          <tbody>
            {run.strategies.map((s, i) => {
              const m = s.summary;
              return (
                <tr key={s.strategyId} className="clickable" onClick={() => navigate(`/strategies/${s.strategyId}`)}>
                  <td>
                    <i className="swatch" style={{ background: seriesColor(i, theme.dark) }} />
                    {s.name}
                    {s === best && run.strategies.length > 1 && <span className="tag ok" style={{ marginLeft: 8 }}>best mean</span>}
                  </td>
                  <td>
                    <Money value={m.mean} digits={2} />
                  </td>
                  <td>
                    <Money value={m.median} />
                  </td>
                  <td className="num">{money(m.stdev)}</td>
                  <td>
                    <Money value={m.p5} />
                  </td>
                  <td>
                    <Money value={m.p95} />
                  </td>
                  <td className="num">{pct(m.winRate)}</td>
                  <td className="num">{pct(m.bustRate)}</td>
                  <td>
                    <Money value={m.profitPerRoll} digits={3} />
                  </td>
                  <td className="num">{m.meanRolls.toFixed(0)}</td>
                  <td className="num">{money(m.meanWagered)}</td>
                  <td className="num">{pct(m.edge, 2)}</td>
                  <td className="num">{money(m.meanMaxDrawdown)}</td>
                  <td>
                    <Money value={m.cvar5} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 8 }}>
          edge = mean loss per dollar wagered (each placement counted once; presses count as new money). worst 5% = average profit of the worst 5% of sessions.
        </p>
      </div>

      <div className="card">
        <h3>Profit per session</h3>
        <div className="grid cards">
          {run.strategies.map((s, i) => (
            <div key={s.strategyId}>
              <p className="chart-title">
                <i className="swatch" style={{ background: seriesColor(i, theme.dark) }} />
                {s.name} · mean {money(s.summary.mean)} (amber line) · median {money(s.summary.median)}
              </p>
              <Histogram hist={s.summary.histogram} color={seriesColor(i, theme.dark)} mean={s.summary.mean} sessions={s.summary.sessions} theme={theme} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid side">
        <div className="card">
          <h3>Equity through a session</h3>
          <EquityLines
            groups={run.strategies.map((s, i) => ({ id: s.strategyId, name: s.name, color: seriesColor(i, theme.dark), series: s.series }))}
            startBankroll={c.bankroll}
            theme={theme}
          />
        </div>
        <div>
          <div className="card">
            <h3>How sessions ended</h3>
            <EndReasons rows={run.strategies.map((s) => ({ id: s.strategyId, name: s.name, reasons: s.endReasons, total: s.summary.sessions }))} theme={theme} />
          </div>
          {run.headToHead && (
            <div className="card">
              <h3>Head to head</h3>
              <p className="hint">Share of sessions where the row beat the column on identical dice.</p>
              <table className="data h2h">
                <thead>
                  <tr>
                    <th></th>
                    {run.strategies.map((s, i) => (
                      <th key={s.strategyId} title={s.name}>
                        <i className="swatch" style={{ background: seriesColor(i, theme.dark) }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.strategies.map((a, i) => (
                    <tr key={a.strategyId}>
                      <td>
                        <i className="swatch" style={{ background: seriesColor(i, theme.dark) }} />
                        {a.name}
                      </td>
                      {run.strategies.map((b, j) => {
                        const v = run.headToHead![i]![j]!;
                        const alpha = i === j ? 0 : Math.min(0.5, Math.abs(v - 0.5) * 1.4);
                        const tone = v > 0.5 ? theme.pos : theme.neg;
                        return (
                          <td key={b.strategyId} className="cell" style={{ background: i === j ? 'transparent' : `color-mix(in srgb, ${tone} ${Math.round(alpha * 100)}%, transparent)` }}>
                            {i === j ? '—' : pct(v, 0)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
