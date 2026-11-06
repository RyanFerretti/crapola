#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  type BatchConfig,
  type BatchResult,
  type SessionResult,
  type Strategy,
  type TableRules,
  STRATEGY_JSON_SCHEMA,
  headToHead,
  parseRolls,
  runBatch,
  runSession,
  validateStrategyDoc,
} from '@crapola/engine';
import { RunStore, StrategyLibrary } from '@crapola/store';
import { money, pct, sparkline, summaryTable, table } from './format.ts';
import { fetchTranscript, formatTranscript } from './transcript.ts';

const HELP = `crapola - craps strategy simulator

usage: bun run cli <command> [options]

commands
  list                          strategies in ./strategies
  validate <id|file>            check a strategy document
  run <id|file> [more...]       simulate one or more strategies on identical dice
  compare <id> <id> [...]       alias of run with several strategies
  play <id|file>                narrate one session roll by roll
  transcript <url|videoId>      fetch a YouTube transcript (cached in tmp/transcripts)
  schema                        print the strategy JSON schema
  docs                          print the strategy DSL reference
  runs                          list saved runs
  export <runId> <file.csv>     export a saved run's sessions to CSV

run / compare options
  --sessions N      sessions per strategy (default 10000)
  --bankroll B      starting bankroll (default: strategy's suggestion or 1000)
  --unit U          override the strategy's betting unit
  --shooters S      shooters per session (default 10)
  --rolls R         hard cap on rolls per session
  --stop-loss L     stop when down L
  --win-goal G      stop when up G
  --seed X          base seed (default 12345)
  --table-min M     table minimum (default 10)
  --odds P          odds policy: 1x 2x 3x 3-4-5x 5x 10x 20x 100x
  --save [name]     save the run to data/crapola.sqlite
  --csv FILE        write per-session rows to a CSV
  --json            print machine-readable JSON instead of tables

play options
  --dice "4 8 6 7"  scripted rolls (totals, "4-4", "H8"); seeded dice take over after
  --bankroll, --unit, --shooters, --rolls, --seed as above
`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
const command = argv[0];
if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const { values, positionals } = parseArgs({
  args: argv.slice(1),
  allowPositionals: true,
  options: {
    sessions: { type: 'string' },
    bankroll: { type: 'string' },
    unit: { type: 'string' },
    shooters: { type: 'string' },
    rolls: { type: 'string' },
    'stop-loss': { type: 'string' },
    'win-goal': { type: 'string' },
    seed: { type: 'string' },
    'table-min': { type: 'string' },
    odds: { type: 'string' },
    save: { type: 'string' },
    csv: { type: 'string' },
    json: { type: 'boolean' },
    dice: { type: 'string' },
    out: { type: 'string' },
    quiet: { type: 'boolean' },
  },
});

const num = (v: string | undefined): number | undefined => (v === undefined ? undefined : Number(v));

/** Bet types a strategy document places, for the list view and coverage checks. */
function betTypesUsed(doc: { rules: Array<{ do: Array<{ action: string; type?: string; on?: string }> }> } | null | undefined): string[] {
  const out = new Set<string>();
  for (const r of doc?.rules ?? []) {
    for (const a of r.do) {
      if (a.action !== 'bet' || !a.type) continue;
      out.add(a.type === 'odds' ? `odds(${a.on})` : a.type);
    }
  }
  return [...out];
}
const lib = new StrategyLibrary('strategies');

function loadAll(ids: string[]): Array<{ strategy: Strategy; doc: ReturnType<typeof lib.load>['doc'] }> {
  if (ids.length === 0) fail('give at least one strategy id or file');
  return ids.map((id) => {
    const l = lib.load(id);
    for (const w of l.warnings) console.error(`warning (${id}): ${w}`);
    return l;
  });
}

function tableRules(): Partial<TableRules> {
  const rules: Partial<TableRules> = {};
  if (values['table-min']) rules.minBet = Number(values['table-min']);
  if (values.odds) rules.oddsPolicy = values.odds as TableRules['oddsPolicy'];
  return rules;
}

function batchConfig(bankrollDefault: number): BatchConfig {
  return {
    sessions: num(values.sessions) ?? 10000,
    bankroll: num(values.bankroll) ?? bankrollDefault,
    unit: num(values.unit),
    maxShooters: num(values.shooters) ?? (values.rolls ? undefined : 10),
    maxRolls: num(values.rolls),
    stopLoss: num(values['stop-loss']),
    winGoal: num(values['win-goal']),
    seed: num(values.seed) ?? 12345,
    rules: tableRules(),
    seriesFor: 20,
  };
}

function writeCsv(file: string, batches: BatchResult[]): void {
  const cols: Array<keyof SessionResult> = [
    'strategyId', 'seed', 'startBankroll', 'endBankroll', 'profit', 'rolls', 'shooters', 'peakEquity', 'troughEquity',
    'maxDrawdown', 'totalWagered', 'totalVig', 'pointsMade', 'endReason', 'rejectedBets',
  ];
  const lines = [['session', ...cols].join(',')];
  for (const b of batches) b.results.forEach((r, i) => lines.push([i, ...cols.map((c) => r[c])].join(',')));
  writeFileSync(file, `${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'list': {
      const entries = lib.list();
      if (values.json) {
        console.log(JSON.stringify(entries.map((e) => ({ id: e.id, name: e.doc?.name, valid: e.issues.length === 0, tags: e.doc?.tags, source: e.doc?.source })), null, 2));
        return;
      }
      const rows = [['id', 'name', 'unit', 'bankroll', 'bets', 'tags', 'source', 'status']];
      for (const e of entries) {
        rows.push([
          e.id,
          e.doc?.name ?? '',
          e.doc?.unit?.toString() ?? '',
          e.doc?.bankroll?.toString() ?? '',
          betTypesUsed(e.doc).join(','),
          (e.doc?.tags ?? []).join(','),
          e.doc?.source ? `${e.doc.source.type}${e.doc.source.title ? `: ${e.doc.source.title.slice(0, 40)}` : ''}` : '',
          e.issues.length ? `INVALID (${e.issues[0]!.message})` : 'ok',
        ]);
      }
      console.log(table(rows));
      return;
    }

    case 'validate': {
      const target = positionals[0] ?? fail('validate needs an id or file');
      const file = target.endsWith('.json') ? target : lib.pathFor(target);
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const v = validateStrategyDoc(raw);
      if (!v.ok) {
        console.error(`INVALID ${file}`);
        for (const i of v.issues) console.error(`  ${i.path}: ${i.message}`);
        process.exit(1);
      }
      console.log(`ok ${file} (${v.doc.rules.length} rules)`);
      for (const w of v.warnings) console.log(`  warning: ${w}`);
      return;
    }

    case 'run':
    case 'compare': {
      const loaded = loadAll(positionals);
      const config = batchConfig(loaded[0]!.doc.bankroll ?? 1000);
      const batches: BatchResult[] = [];
      for (const { strategy } of loaded) {
        const t0 = performance.now();
        const batch = runBatch(strategy, {
          ...config,
          onProgress: values.quiet || values.json || !process.stderr.isTTY ? undefined : (done, total) => process.stderr.write(`\r${strategy.id}: ${done}/${total}`),
        });
        if (!values.quiet && !values.json) process.stderr.write(`${process.stderr.isTTY ? '\r' : ''}${strategy.id}: ${config.sessions} sessions in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
        batches.push(batch);
      }
      if (values.csv) writeCsv(values.csv, batches);
      if (values.save !== undefined) {
        const store = new RunStore();
        const id = store.saveRun(
          config,
          batches.map((b, i) => ({
            strategyId: b.strategyId,
            doc: loaded[i]!.doc,
            summary: b.summary,
            results: b.results,
            series: b.results.slice(0, config.seriesFor ?? 0).map((r) => r.series ?? []),
            elapsedMs: b.elapsedMs,
          })),
          values.save || undefined,
        );
        store.close();
        if (!values.json) console.log(`saved run #${id}`);
      }
      if (values.json) {
        console.log(JSON.stringify({ config, summaries: batches.map((b) => b.summary) }, null, 2));
        return;
      }
      console.log(`\n${config.sessions} sessions, bankroll ${money(config.bankroll)}, ${config.maxShooters ? `${config.maxShooters} shooters` : `${config.maxRolls} rolls`}, seed ${config.seed}\n`);
      console.log(summaryTable(batches.map((b) => b.summary)));
      console.log('');
      for (const b of batches) {
        const h = b.summary.histogram;
        console.log(`${b.strategyId.padEnd(24)} ${money(h.binStart).padStart(7)} ${sparkline(h)} ${money(h.binStart + h.binWidth * h.counts.length)}`);
        console.log(`${''.padEnd(24)} p25 ${money(b.summary.p25)}  p75 ${money(b.summary.p75)}  worst 5% avg ${money(b.summary.cvar5)}  ends: ${Object.entries(b.summary.endReasons).map(([k, v]) => `${k} ${pct(v / b.summary.sessions, 0)}`).join(', ')}`);
      }
      if (batches.length > 1) {
        console.log('\nhead to head on identical dice (rows beat columns):');
        const ids = batches.map((b) => b.strategyId);
        const rows = [['', ...ids]];
        for (const a of batches) {
          rows.push([a.strategyId, ...batches.map((b) => (a === b ? '-' : pct(headToHead(a.results, b.results).aWins / a.results.length, 0)))]);
        }
        console.log(table(rows, ['l', ...ids.map(() => 'r' as const)]));
      }
      return;
    }

    case 'play': {
      const { strategy, doc } = loadAll([positionals[0] ?? fail('play needs a strategy')])[0]!;
      const fixedRolls = values.dice ? parseRolls(values.dice) : undefined;
      const r = runSession(strategy, {
        bankroll: num(values.bankroll) ?? doc.bankroll ?? 1000,
        unit: num(values.unit),
        // With scripted dice and no caps the session ends when the script runs out, after the last reaction.
        maxShooters: num(values.shooters) ?? (values.rolls || fixedRolls ? undefined : 3),
        maxRolls: num(values.rolls),
        stopLoss: num(values['stop-loss']),
        winGoal: num(values['win-goal']),
        seed: num(values.seed) ?? Math.floor(Math.random() * 1e9),
        rules: tableRules(),
        fixedRolls,
        recordLog: true,
      });
      if (values.json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      console.log(`${doc.name} - bankroll ${money(r.startBankroll)}, seed ${r.seed}\n`);
      for (const l of r.log ?? []) {
        if (l.rollNumber === 0) console.log('session start');
        else {
          const pt = l.pointBefore === null ? 'come-out' : `point ${l.pointBefore}`;
          console.log(`#${l.rollNumber} shooter ${l.shooterIndex} (${pt}) rolled ${l.d1}-${l.d2} = ${l.total}${l.pointAfter !== l.pointBefore ? (l.pointAfter ? `  -> point ${l.pointAfter}` : l.total === 7 ? '  -> seven out' : '  -> point made') : ''}`);
        }
        for (const o of l.outcomes) console.log(`    ${o}`);
        for (const t of l.trace) console.log(`    ${t}`);
        if (l.state && Object.keys(l.state).length) console.log(`    state ${JSON.stringify(l.state)}`);
        console.log(`    bankroll ${money(l.bankroll)}  on table ${money(l.equity - l.bankroll)}  equity ${money(l.equity)}${l.betsAfter.length ? `  [${l.betsAfter.join(', ')}]` : ''}`);
      }
      console.log(`\nend: ${r.endReason === 'diceExhausted' ? 'dice script finished' : r.endReason} after ${r.rolls} rolls / ${r.shooters} shooters. profit ${money(r.profit)} (peak ${money(r.peakEquity - r.startBankroll)}, max drawdown ${money(r.maxDrawdown)}, wagered ${money(r.totalWagered)})`);
      return;
    }

    case 'transcript': {
      const t = await fetchTranscript(positionals[0] ?? fail('transcript needs a YouTube url or id'));
      const text = values.json ? JSON.stringify(t, null, 2) : formatTranscript(t);
      if (values.out) {
        writeFileSync(values.out, text);
        console.log(`wrote ${values.out} (${t.segments.length} segments, ${t.text.length} chars)`);
      } else console.log(text);
      return;
    }

    case 'schema':
      console.log(JSON.stringify(STRATEGY_JSON_SCHEMA, null, 2));
      return;

    case 'docs':
      console.log(readFileSync(new URL('../../../docs/strategy-dsl.md', import.meta.url), 'utf8'));
      return;

    case 'runs': {
      const store = new RunStore();
      const rows = [['id', 'created', 'name', 'sessions', 'bankroll', 'strategies (mean)']];
      for (const r of store.listRuns()) {
        rows.push([String(r.id), r.createdAt.slice(0, 16).replace('T', ' '), r.name ?? '', String(r.sessions), money(r.bankroll), r.strategyIds.map((s) => `${s} (${money(r.means[s] ?? 0)})`).join(', ')]);
      }
      console.log(table(rows));
      store.close();
      return;
    }

    case 'export': {
      const id = Number(positionals[0] ?? fail('export needs a run id'));
      const file = positionals[1] ?? fail('export needs an output file');
      const store = new RunStore();
      const run = store.getRun(id) ?? fail(`no run #${id}`);
      writeCsv(
        file,
        run.strategies.map((s) => ({ strategyId: s.strategyId, results: s.results, summary: s.summary, config: run.config, elapsedMs: s.elapsedMs })),
      );
      console.log(`wrote ${file}`);
      store.close();
      return;
    }

    default:
      fail(`unknown command "${command}"\n\n${HELP}`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
