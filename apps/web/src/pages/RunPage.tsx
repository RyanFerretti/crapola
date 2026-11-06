import { useEffect, useMemo, useState } from 'react';
import { type JobState, type StrategyListItem, api } from '../api.ts';
import { Field, NumberInput, PageHead, Select, TextInput } from '../components/ui.tsx';
import { navigate } from '../router.ts';

const ODDS = ['1x', '2x', '3x', '3-4-5x', '5x', '10x', '20x', '100x'] as const;

export function RunPage({ query }: { query: URLSearchParams }) {
  const [items, setItems] = useState<StrategyListItem[]>([]);
  const [selected, setSelected] = useState<string[]>(() => (query.get('ids') ?? '').split(',').filter(Boolean));
  const [q, setQ] = useState('');
  const [name, setName] = useState<string | undefined>();
  const [sessions, setSessions] = useState<number | undefined>(10000);
  const [bankroll, setBankroll] = useState<number | undefined>();
  const [shooters, setShooters] = useState<number | undefined>(10);
  const [rolls, setRolls] = useState<number | undefined>();
  const [seed, setSeed] = useState<number | undefined>(12345);
  const [stopLoss, setStopLoss] = useState<number | undefined>();
  const [winGoal, setWinGoal] = useState<number | undefined>();
  const [unit, setUnit] = useState<number | undefined>();
  const [tableMin, setTableMin] = useState<number | undefined>();
  const [odds, setOdds] = useState<string | undefined>();
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touchedBankroll, setTouchedBankroll] = useState(false);

  useEffect(() => {
    api.strategies().then((s) => setItems(s.filter((x) => x.valid))).catch((e) => setError(e.message));
  }, []);

  // Re-run from a saved run: copy its config.
  useEffect(() => {
    const from = query.get('from');
    if (!from) return;
    api
      .run(from)
      .then((r) => {
        setSelected(r.strategies.map((s) => s.strategyId));
        setSessions(r.config.sessions);
        setBankroll(r.config.bankroll);
        setTouchedBankroll(true);
        setShooters(r.config.maxShooters);
        setRolls(r.config.maxRolls);
        setSeed(r.config.seed);
        setStopLoss(r.config.stopLoss);
        setWinGoal(r.config.winGoal);
        setUnit(r.config.unit);
        setTableMin(r.config.rules?.minBet);
        setOdds(r.config.rules?.oddsPolicy);
        setName(r.name ?? undefined);
      })
      .catch((e) => setError(e.message));
  }, [query]);

  const first = useMemo(() => items.find((i) => i.id === selected[0]), [items, selected]);
  useEffect(() => {
    if (!touchedBankroll && first?.bankroll) setBankroll(first.bankroll);
  }, [first, touchedBankroll]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const launch = async () => {
    setError(null);
    try {
      const j = await api.startRun({ strategyIds: selected, name, sessions, bankroll, shooters, rolls, seed, stopLoss, winGoal, unit, tableMin, odds });
      setJob(j);
      const es = new EventSource(`/api/jobs/${j.id}/events`);
      es.addEventListener('state', (ev) => {
        const state = JSON.parse((ev as MessageEvent).data) as JobState;
        setJob(state);
        if (state.status !== 'running') {
          es.close();
          if (state.status === 'done' && state.runId) navigate(`/runs/${state.runId}`);
          if (state.status === 'error') setError(state.error ?? 'run failed');
        }
      });
      es.onerror = () => {
        es.close();
        // Fall back to polling if the stream drops.
        const poll = window.setInterval(async () => {
          const s = await api.job(j.id).catch(() => null);
          if (!s) return;
          setJob(s);
          if (s.status !== 'running') {
            window.clearInterval(poll);
            if (s.status === 'done' && s.runId) navigate(`/runs/${s.runId}`);
            if (s.status === 'error') setError(s.error ?? 'run failed');
          }
        }, 500);
      };
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filtered = items.filter((i) => `${i.id} ${i.name} ${i.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const running = job?.status === 'running';

  return (
    <>
      <PageHead
        eyebrow="Simulate"
        title="Run a batch"
        blurb="Every strategy in a run sees the same dice sequence per session, so differences in results are the strategy, not the luck."
      />
      {error && <div className="issues">{error}</div>}
      <div className="grid side">
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Strategies</h3>
            <span className="hint">{selected.length} selected</span>
            <span className="spacer" />
            <input type="search" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          </div>
          <table className="data">
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => toggle(s.id)}>
                  <td style={{ width: 28 }}>
                    <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div>{s.name}</div>
                    <div className="hint mono">{s.id}</div>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    {s.tags.map((t) => (
                      <span key={t} className="tag" style={{ marginRight: 4 }}>
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="num">{s.unit ? `$${s.unit}` : ''}</td>
                  <td className="num">{s.bankroll ? `$${s.bankroll}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="card">
            <h3>Session</h3>
            <div className="row">
              <Field label="sessions">
                <NumberInput value={sessions} onChange={setSessions} min={1} />
              </Field>
              <Field label="bankroll">
                <NumberInput
                  value={bankroll}
                  onChange={(v) => {
                    setTouchedBankroll(true);
                    setBankroll(v);
                  }}
                />
              </Field>
            </div>
            <div className="row">
              <Field label="shooters">
                <NumberInput value={shooters} onChange={setShooters} min={1} />
              </Field>
              <Field label="max rolls">
                <NumberInput value={rolls} onChange={setRolls} placeholder="none" />
              </Field>
              <Field label="seed">
                <NumberInput value={seed} onChange={setSeed} />
              </Field>
            </div>
            <div className="row">
              <Field label="stop loss">
                <NumberInput value={stopLoss} onChange={setStopLoss} placeholder="none" />
              </Field>
              <Field label="win goal">
                <NumberInput value={winGoal} onChange={setWinGoal} placeholder="none" />
              </Field>
            </div>
          </div>
          <div className="card">
            <h3>Table</h3>
            <div className="row">
              <Field label="unit override">
                <NumberInput value={unit} onChange={setUnit} placeholder="strategy's" />
              </Field>
              <Field label="table min">
                <NumberInput value={tableMin} onChange={setTableMin} placeholder="10" />
              </Field>
              <Field label="odds">
                <Select value={odds as (typeof ODDS)[number]} options={ODDS} allowEmpty="3-4-5x" onChange={setOdds} />
              </Field>
            </div>
            <Field label="run name (optional)">
              <TextInput value={name} onChange={setName} placeholder="e.g. donts vs molly, 10 shooters" />
            </Field>
          </div>
          <div className="card">
            <button className="primary" style={{ width: '100%', justifyContent: 'center' }} disabled={selected.length === 0 || running} onClick={launch}>
              {running ? 'running…' : `Launch ${selected.length || ''} ${selected.length === 1 ? 'strategy' : 'strategies'}`}
            </button>
            {job && (
              <div style={{ marginTop: 14 }}>
                {Object.entries(job.progress).map(([id, p]) => (
                  <div key={id} style={{ marginBottom: 8 }}>
                    <div className="toolbar small" style={{ marginBottom: 3 }}>
                      <span className="mono">{id}</span>
                      <span className="spacer" />
                      <span className="num muted">
                        {p.done.toLocaleString()} / {p.total.toLocaleString()}
                      </span>
                    </div>
                    <div className="progress">
                      <div style={{ width: `${(100 * p.done) / Math.max(1, p.total)}%` }} />
                    </div>
                  </div>
                ))}
                {job.status === 'done' && job.runId && (
                  <a className="btn primary" href={`#/runs/${job.runId}`}>
                    View run #{job.runId}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
