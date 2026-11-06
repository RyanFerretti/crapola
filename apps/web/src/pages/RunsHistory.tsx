import { useEffect, useState } from 'react';
import { type RunListItem, api } from '../api.ts';
import { Empty, Money, PageHead } from '../components/ui.tsx';
import { money, when } from '../format.ts';
import { navigate } from '../router.ts';

export function RunsHistory() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.runs().then(setRuns).catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHead eyebrow="Saved results" title="Runs" blurb="Every batch is stored in data/crapola.sqlite with its full per-session results." actions={<a className="btn primary" href="#/run">New run</a>} />
      {error && <div className="issues">{error}</div>}
      {runs && runs.length === 0 && <Empty>No runs saved yet.</Empty>}
      {runs && runs.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>when</th>
                <th style={{ textAlign: 'left' }}>name</th>
                <th>sessions</th>
                <th>bankroll</th>
                <th style={{ textAlign: 'left' }}>strategies (mean profit)</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/runs/${r.id}`)}>
                  <td className="num" style={{ textAlign: 'left' }}>
                    {r.id}
                  </td>
                  <td style={{ textAlign: 'left' }}>{when(r.createdAt)}</td>
                  <td style={{ textAlign: 'left' }}>{r.name ?? <span className="muted">—</span>}</td>
                  <td className="num">{r.sessions.toLocaleString()}</td>
                  <td className="num">{money(r.bankroll)}</td>
                  <td style={{ textAlign: 'left' }}>
                    {r.strategyIds.map((s) => (
                      <span key={s} className="tag" style={{ marginRight: 6 }}>
                        {s} <Money value={r.means[s] ?? 0} />
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
