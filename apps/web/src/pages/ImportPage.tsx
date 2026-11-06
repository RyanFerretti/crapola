import { useState } from 'react';
import { type Transcript, api } from '../api.ts';
import { Field, PageHead, TextInput } from '../components/ui.tsx';

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ImportPage({ query }: { query: URLSearchParams }) {
  const [url, setUrl] = useState<string | undefined>(query.get('url') ?? undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState<Transcript | null>(null);

  const fetchIt = async () => {
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      setT(await api.transcript(url));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead eyebrow="From video to strategy" title="Import" blurb="Strategies get translated from a video by an agent that reads the transcript and writes the JSON for you." />
      <div className="grid side">
        <div className="card">
          <h3>Transcript viewer</h3>
          <div className="row">
            <Field label="YouTube URL or video id" className="grow">
              <TextInput value={url} onChange={setUrl} placeholder="https://www.youtube.com/watch?v=…" />
            </Field>
            <button className="primary fixed" onClick={fetchIt} disabled={!url || busy}>
              {busy ? 'fetching…' : 'Fetch transcript'}
            </button>
          </div>
          {error && <div className="issues">{error}</div>}
          {t && (
            <>
              <h3 style={{ marginTop: 14 }}>{t.title}</h3>
              <p className="hint">
                {t.channel} · {ts(t.duration)} · {t.segments.length} segments ·{' '}
                <a href={t.url} target="_blank" rel="noreferrer">
                  open on YouTube
                </a>
              </p>
              <pre className="transcript">
                {t.segments.map((s) => (
                  <div key={s.start}>
                    <span className="ts">[{ts(s.start)}]</span>
                    {s.text}
                  </div>
                ))}
              </pre>
            </>
          )}
        </div>
        <div>
          <div className="card">
            <h3>How importing works</h3>
            <div className="callout">
              In Claude Code, from this repo, run:
              <br />
              <code>/import-video https://www.youtube.com/watch?v=…</code>
            </div>
            <ol className="small" style={{ paddingLeft: 18 }}>
              <li>The agent pulls the captions (same as this viewer, via yt-dlp).</li>
              <li>It writes the system down as rules keyed to table state, then translates them into the strategy DSL.</li>
              <li>It validates the JSON, plays scripted dice through it, runs a batch, and saves the result to <code>strategies/&lt;id&gt;.json</code>.</li>
              <li>Ambiguities and assumptions land in the strategy's <code>notes</code>, which show up in the editor.</li>
            </ol>
            <p className="small muted">Transcripts are cached in <code>tmp/transcripts/</code>. The CLI equivalent is <code>bun run cli transcript &lt;url&gt;</code>.</p>
          </div>
          <div className="card">
            <h3>Reading a Crappy video</h3>
            <ul className="small" style={{ paddingLeft: 18 }}>
              <li>The system is explained in the first few minutes; the live play that follows shows the real pressing and regression habits.</li>
              <li>Listen for the table minimum and the buy-in; those become <code>table.minBet</code> and <code>bankroll</code>.</li>
              <li>"Inside", "across", "outside" are spreads: $44 inside is $10 on 5/9 and $12 on 6/8.</li>
              <li>"Press" means add winnings to the bet; "same bet" means collect and leave it.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
