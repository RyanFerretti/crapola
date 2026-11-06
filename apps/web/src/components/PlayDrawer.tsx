import { useEffect, useState } from 'react';
import type { RollRecord, SessionResult } from '@crapola/engine';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type EDoc, api } from '../api.ts';
import { money } from '../format.ts';
import { useChartTheme } from '../theme.ts';
import { Field, Money, NumberInput, TextInput } from './ui.tsx';

const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export function PlayDrawer({ doc, onClose }: { doc: EDoc; onClose: () => void }) {
  const [dice, setDice] = useState<string | undefined>(undefined);
  const [bankroll, setBankroll] = useState<number | undefined>(doc.bankroll);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [shooters, setShooters] = useState<number | undefined>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const theme = useChartTheme();

  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.play({ doc, dice, bankroll, seed, shooters: dice && !shooters ? undefined : shooters }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const series = result?.series?.map((equity, i) => ({ i, equity })) ?? [];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Play one session">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Play: {doc.name}</h2>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            close ✕
          </button>
        </div>
        <div className="row">
          <Field label="dice script" className="grow" hint='totals or faces: "4 8 H6 3-4 7". Seeded dice take over after.'>
            <TextInput mono value={dice} onChange={setDice} placeholder="leave empty for random dice" />
          </Field>
          <Field label="bankroll">
            <NumberInput value={bankroll} onChange={setBankroll} />
          </Field>
          <Field label="seed">
            <NumberInput value={seed} onChange={setSeed} placeholder="random" />
          </Field>
          <Field label="shooters">
            <NumberInput value={shooters} onChange={setShooters} min={1} />
          </Field>
          <button className="primary fixed" onClick={play} disabled={busy}>
            {busy ? 'rolling…' : 'Roll'}
          </button>
        </div>
        {error && <div className="issues">{error}</div>}
        {result && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="k">profit</div>
                <div className="v">
                  <Money value={result.profit} />
                </div>
              </div>
              <div className="stat">
                <div className="k">rolls / shooters</div>
                <div className="v">
                  {result.rolls} / {result.shooters}
                </div>
              </div>
              <div className="stat">
                <div className="k">peak / drawdown</div>
                <div className="v">
                  {money(result.peakEquity - result.startBankroll)} / {money(result.maxDrawdown)}
                </div>
              </div>
              <div className="stat">
                <div className="k">ended</div>
                <div className="v" style={{ fontSize: '1rem' }}>
                  {result.endReason}
                  <div className="hint">seed {result.seed}</div>
                </div>
              </div>
            </div>
            {series.length > 2 && (
              <div style={{ height: 160, marginBottom: 12 }}>
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <XAxis dataKey="i" tick={{ fontSize: 11, fill: theme.muted }} stroke={theme.grid} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: theme.muted }} stroke={theme.grid} tickLine={false} width={56} tickFormatter={(v: number) => money(v)} />
                    <ReferenceLine y={result.startBankroll} stroke={theme.muted} strokeDasharray="0" />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="tip">
                            roll {payload[0]!.payload.i}
                            <span className="num">equity {money(payload[0]!.payload.equity)}</span>
                          </div>
                        ) : null
                      }
                    />
                    <Line type="monotone" dataKey="equity" stroke={theme.pos} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div>
              {(result.log ?? []).map((l) => (
                <RollRow key={l.rollNumber} l={l} prevShooter={l.shooterIndex} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function RollRow({ l }: { l: RollRecord; prevShooter: number }) {
  const start = l.rollNumber === 0;
  const madePoint = l.pointBefore !== null && l.pointAfter === null && l.total === l.pointBefore;
  const sevenOut = l.pointBefore !== null && l.total === 7;
  const newPoint = l.pointBefore === null && l.pointAfter !== null;
  return (
    <div className={`roll ${l.pointBefore === null && !start ? 'shooter-start' : ''}`}>
      <div>
        {start ? (
          <div className="pt">session start</div>
        ) : (
          <>
            <div className="dice-face" aria-label={`${l.d1} and ${l.d2}`}>
              {FACES[l.d1]}
              {FACES[l.d2]}
            </div>
            <div className="pt">
              #{l.rollNumber} · sh {l.shooterIndex} · {l.pointBefore === null ? 'come-out' : `point ${l.pointBefore}`}
            </div>
            <div>
              <strong className="num">{l.total}</strong>{' '}
              {newPoint && <span className="badge point">point {l.pointAfter}</span>}
              {madePoint && <span className="badge made">point made</span>}
              {sevenOut && <span className="badge seven">seven out</span>}
            </div>
          </>
        )}
      </div>
      <div className="lines">
        {l.outcomes.map((o, i) => (
          <div key={`o${i}`} className="out">
            {o}
          </div>
        ))}
        {l.actions.map((a, i) => (
          <div key={`a${i}`} className="act">
            {a}
          </div>
        ))}
        {l.logs.map((g, i) => (
          <div key={`g${i}`} className="log">
            {g}
          </div>
        ))}
        {l.betsAfter.length > 0 && <div className="bets">{l.betsAfter.join(' · ')}</div>}
        {l.state && Object.keys(l.state).length > 0 && <div className="bets">{JSON.stringify(l.state)}</div>}
      </div>
      <div className="money">
        <div>rack {money(l.bankroll)}</div>
        <div className="muted">table {money(l.equity - l.bankroll)}</div>
        <div>
          <strong>{money(l.equity)}</strong>
        </div>
      </div>
    </div>
  );
}
