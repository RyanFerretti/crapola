import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import {
  BET_TYPES,
  BUILTIN_FNS,
  BUILTIN_IDS,
  EVENT_KINDS,
  STRATEGY_JSON_SCHEMA,
  type StrategyDoc,
  type TableRules,
  compileStrategy,
  headToHead,
  parseRolls,
  runSession,
  validateStrategyDoc,
} from '@crapola/engine';
import { RunStore, StrategyLibrary } from '@crapola/store';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { fetchTranscript } from '../../../packages/cli/src/transcript.ts';
import { type JobConfig, JobManager } from './jobs.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const DIST = resolve(import.meta.dir, '../dist');
const PORT = Number(process.env.PORT ?? 4242);

const lib = new StrategyLibrary(join(ROOT, 'strategies'));
const store = new RunStore(join(ROOT, 'data/crapola.sqlite'));
const jobs = new JobManager(store);

const app = new Hono();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));

function tableRules(body: Record<string, unknown>): Partial<TableRules> {
  const rules: Partial<TableRules> = {};
  const min = num(body.tableMin);
  if (min !== undefined && !Number.isNaN(min)) rules.minBet = min;
  if (typeof body.odds === 'string' && body.odds) rules.oddsPolicy = body.odds as TableRules['oddsPolicy'];
  return rules;
}

function resolveDoc(body: Record<string, unknown>): { ok: true; doc: StrategyDoc } | { ok: false; status: number; error: string; issues?: unknown } {
  if (body.doc) {
    const v = validateStrategyDoc(body.doc);
    if (!v.ok) return { ok: false, status: 400, error: 'invalid strategy document', issues: v.issues };
    return { ok: true, doc: v.doc };
  }
  if (typeof body.strategyId === 'string') {
    const entry = lib.get(body.strategyId);
    if (!entry) return { ok: false, status: 404, error: `no strategy "${body.strategyId}"` };
    if (!entry.doc) return { ok: false, status: 400, error: `strategy "${body.strategyId}" is invalid`, issues: entry.issues };
    return { ok: true, doc: entry.doc };
  }
  return { ok: false, status: 400, error: 'provide strategyId or doc' };
}

function entrySummary(e: ReturnType<StrategyLibrary['list']>[number]) {
  return {
    id: e.id,
    name: e.doc?.name ?? e.id,
    description: e.doc?.description ?? '',
    tags: e.doc?.tags ?? [],
    source: e.doc?.source ?? null,
    unit: e.doc?.unit ?? null,
    bankroll: e.doc?.bankroll ?? null,
    ruleCount: e.doc?.rules.length ?? 0,
    valid: e.issues.length === 0,
    issues: e.issues,
    warnings: e.warnings,
  };
}

// ---------------------------------------------------------------------------
// strategies
// ---------------------------------------------------------------------------

app.get('/api/strategies', (c) => c.json(lib.list().map(entrySummary)));

app.get('/api/strategies/:id', (c) => {
  const entry = lib.get(c.req.param('id'));
  if (!entry) return c.json({ error: 'not found' }, 404);
  const raw = JSON.parse(readFileSync(entry.file, 'utf8'));
  return c.json({ ...entrySummary(entry), doc: entry.doc ?? raw });
});

app.post('/api/strategies', async (c) => {
  const body = await c.req.json();
  const id = typeof body?.id === 'string' ? body.id : '';
  if (id && lib.get(id)) return c.json({ error: `strategy "${id}" already exists` }, 409);
  const saved = lib.save(body);
  if (!saved.ok) return c.json({ error: 'invalid strategy document', issues: saved.issues }, 400);
  return c.json({ ok: true, id: saved.doc.id, warnings: saved.warnings }, 201);
});

app.put('/api/strategies/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  if (body?.id && body.id !== id) {
    // Renaming: write the new file, drop the old one.
    const saved = lib.save(body);
    if (!saved.ok) return c.json({ error: 'invalid strategy document', issues: saved.issues }, 400);
    lib.delete(id);
    return c.json({ ok: true, id: saved.doc.id, renamed: true, warnings: saved.warnings });
  }
  const saved = lib.save({ ...body, id });
  if (!saved.ok) return c.json({ error: 'invalid strategy document', issues: saved.issues }, 400);
  return c.json({ ok: true, id: saved.doc.id, warnings: saved.warnings });
});

app.delete('/api/strategies/:id', (c) => (lib.delete(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

app.post('/api/validate', async (c) => {
  const body = await c.req.json();
  const v = validateStrategyDoc(body);
  return c.json(v.ok ? { ok: true, issues: [], warnings: v.warnings } : { ok: false, issues: v.issues, warnings: [] });
});

app.get('/api/reference', (c) => {
  const docsPath = join(ROOT, 'docs/strategy-dsl.md');
  return c.json({
    identifiers: BUILTIN_IDS,
    functions: BUILTIN_FNS,
    betTypes: BET_TYPES,
    eventKinds: EVENT_KINDS,
    triggers: ['always', 'comeOut', 'pointOn', ...EVENT_KINDS],
    schema: STRATEGY_JSON_SCHEMA,
    docs: existsSync(docsPath) ? readFileSync(docsPath, 'utf8') : '',
  });
});

// ---------------------------------------------------------------------------
// play one session
// ---------------------------------------------------------------------------

app.post('/api/play', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const r = resolveDoc(body);
  if (!r.ok) return c.json({ error: r.error, issues: r.issues }, r.status as 400);
  let fixedRolls: Array<[number, number]> | undefined;
  try {
    fixedRolls = typeof body.dice === 'string' && body.dice.trim() ? parseRolls(body.dice) : undefined;
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  const shooters = num(body.shooters);
  const rolls = num(body.rolls);
  const result = runSession(compileStrategy(r.doc), {
    bankroll: num(body.bankroll) ?? r.doc.bankroll ?? 1000,
    unit: num(body.unit),
    maxShooters: shooters ?? (rolls || fixedRolls ? undefined : 3),
    // With scripted dice and no caps the session ends when the script runs out, after the last reaction.
    maxRolls: rolls,
    stopLoss: num(body.stopLoss),
    winGoal: num(body.winGoal),
    seed: num(body.seed) ?? Math.floor(Math.random() * 1e9),
    rules: tableRules(body),
    fixedRolls,
    recordLog: true,
    recordSeries: true,
  });
  return c.json(result);
});

// ---------------------------------------------------------------------------
// batch runs + jobs
// ---------------------------------------------------------------------------

app.post('/api/runs', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const ids = Array.isArray(body.strategyIds) ? (body.strategyIds as string[]) : [];
  if (ids.length === 0) return c.json({ error: 'strategyIds is required' }, 400);
  const docs: StrategyDoc[] = [];
  for (const id of ids) {
    const entry = lib.get(id);
    if (!entry) return c.json({ error: `no strategy "${id}"` }, 404);
    if (!entry.doc) return c.json({ error: `strategy "${id}" is invalid`, issues: entry.issues }, 400);
    docs.push(entry.doc);
  }
  const sessions = Math.max(1, Math.min(200_000, num(body.sessions) ?? 10000));
  const shooters = num(body.shooters);
  const rolls = num(body.rolls);
  const config: JobConfig = {
    sessions,
    bankroll: num(body.bankroll) ?? docs[0]!.bankroll ?? 1000,
    unit: num(body.unit),
    maxShooters: shooters ?? (rolls ? undefined : 10),
    maxRolls: rolls,
    stopLoss: num(body.stopLoss),
    winGoal: num(body.winGoal),
    seed: num(body.seed) ?? 12345,
    rules: tableRules(body),
    seriesFor: 20,
  };
  const job = jobs.start(docs, config, typeof body.name === 'string' && body.name ? body.name : undefined);
  return c.json(job, 202);
});

app.get('/api/jobs', (c) => c.json(jobs.list()));

app.get('/api/jobs/:id', (c) => {
  const job = jobs.get(c.req.param('id'));
  return job ? c.json(job) : c.json({ error: 'not found' }, 404);
});

app.get('/api/jobs/:id/events', (c) => {
  const id = c.req.param('id');
  const job = jobs.get(id);
  if (!job) return c.json({ error: 'not found' }, 404);
  return streamSSE(c, async (stream) => {
    let seq = 0;
    await stream.writeSSE({ event: 'state', data: JSON.stringify(job), id: String(seq++) });
    if (job.status !== 'running') return;
    await new Promise<void>((done) => {
      const unsubscribe = jobs.subscribe(id, (state) => {
        void stream.writeSSE({ event: 'state', data: JSON.stringify(state), id: String(seq++) }).then(() => {
          if (state.status !== 'running') {
            unsubscribe();
            done();
          }
        });
      });
      stream.onAbort(() => {
        unsubscribe();
        done();
      });
    });
  });
});

app.get('/api/runs', (c) => c.json(store.listRuns(Number(c.req.query('limit') ?? 100))));

app.get('/api/runs/:id', (c) => {
  const run = store.getRun(Number(c.req.param('id')));
  if (!run) return c.json({ error: 'not found' }, 404);
  const n = run.strategies.length;
  const matrix: number[][] = run.strategies.map((a) =>
    run.strategies.map((b) => {
      if (a === b) return 0;
      const h = headToHead(a.results, b.results);
      const total = h.aWins + h.bWins + h.ties;
      return total ? h.aWins / total : 0;
    }),
  );
  return c.json({
    id: run.id,
    createdAt: run.createdAt,
    name: run.name,
    config: run.config,
    strategies: run.strategies.map((s) => ({
      strategyId: s.strategyId,
      name: s.doc?.name ?? s.strategyId,
      doc: s.doc,
      summary: s.summary,
      series: s.series,
      profits: s.results.map((r) => r.profit),
      endReasons: s.summary.endReasons,
      elapsedMs: s.elapsedMs,
    })),
    headToHead: n > 1 ? matrix : null,
  });
});

app.delete('/api/runs/:id', (c) => (store.deleteRun(Number(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

// ---------------------------------------------------------------------------
// transcripts
// ---------------------------------------------------------------------------

app.get('/api/transcript', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'url is required' }, 400);
  try {
    const t = await fetchTranscript(url, join(ROOT, 'tmp/transcripts'));
    return c.json(t);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ---------------------------------------------------------------------------
// static UI (production build)
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
};

app.get('*', async (c) => {
  if (!existsSync(DIST)) return c.text(`UI not built. Run "bun run --cwd apps/web build" or use the Vite dev server on http://localhost:5173`, 404);
  const path = normalize(decodeURIComponent(new URL(c.req.url).pathname));
  const candidate = join(DIST, path);
  const file = candidate.startsWith(DIST) && existsSync(candidate) && !candidate.endsWith('/') && extname(candidate) ? candidate : join(DIST, 'index.html');
  const bunFile = Bun.file(file);
  return new Response(bunFile, { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

console.log(`crapola api on http://localhost:${PORT}  (strategies: ${lib.dir})`);

export default { port: PORT, fetch: app.fetch, idleTimeout: 255 };
