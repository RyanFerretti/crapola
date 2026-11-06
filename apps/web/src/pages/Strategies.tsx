import { useEffect, useState } from 'react';
import { type StrategyListItem, api } from '../api.ts';
import { navigate } from '../router.ts';
import { Empty, PageHead } from '../components/ui.tsx';

export function Strategies() {
  const [items, setItems] = useState<StrategyListItem[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.strategies().then(setItems).catch((e) => setError(e.message));
  }, []);

  const filtered = (items ?? []).filter((s) => {
    const hay = `${s.id} ${s.name} ${s.description} ${s.tags.join(' ')} ${s.source?.title ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <>
      <PageHead
        eyebrow="Strategy bank"
        title="Strategies"
        blurb="Every file in strategies/ shows up here. Open one to edit it, watch it play, or pick several to simulate on identical dice."
        actions={
          <>
            <input type="search" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            <button className="primary" onClick={() => navigate('/strategies/new')}>
              + New strategy
            </button>
          </>
        }
      />
      {error && <div className="issues">{error}</div>}
      {items && items.length === 0 && <Empty>No strategies yet. Create one or run <code>/import-video</code> in Claude Code.</Empty>}
      <div className="grid cards">
        {filtered.map((s, i) => (
          <div key={s.id} className="card strategy-card" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => navigate(`/strategies/${s.id}`)}>
            <div>
              <div className="title">{s.name}</div>
              <div className="hint mono">{s.id}</div>
            </div>
            <div className="desc">{s.description || <span className="muted">No description</span>}</div>
            <div className="chips">
              {!s.valid && <span className="tag bad">invalid</span>}
              {s.source && <span className="tag src">{s.source.type === 'youtube' ? '▶ ' : ''}{s.source.type}</span>}
              {s.tags.filter((t) => t !== s.source?.type).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
            <div className="meta">
              <span>{s.ruleCount} rules</span>
              {s.unit && <span>unit ${s.unit}</span>}
              {s.bankroll && <span>buy-in ${s.bankroll.toLocaleString()}</span>}
              {s.source?.channel && <span>{s.source.channel}</span>}
            </div>
            <div className="toolbar" onClick={(e) => e.stopPropagation()}>
              <a className="btn" href={`#/run?ids=${encodeURIComponent(s.id)}`}>
                Run
              </a>
              <a className="btn" href={`#/strategies/${s.id}?play=1`}>
                Play
              </a>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
