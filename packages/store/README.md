# @crapola/store

Persistence for the CLI and the web app.

## StrategyLibrary

One JSON document per strategy in a directory (`strategies/` by default). Every read validates, so a broken file shows up as an entry with `issues` and its `raw` JSON instead of crashing the listing.

```ts
import { StrategyLibrary } from '@crapola/store';

const lib = new StrategyLibrary('strategies');
lib.list();                       // LibraryEntry[]: id, file, doc | null, raw, issues, warnings
const { strategy, doc } = lib.load('three-point-molly');   // id or a path to a .json file
lib.save(doc);                    // validates, writes strategies/<id>.json, returns issues when invalid
lib.delete('old-id');
```

## RunStore

Batch results in SQLite through `bun:sqlite`. Default path `data/crapola.sqlite` (gitignored); pass `':memory:'` in tests.

```ts
import { RunStore } from '@crapola/store';

const store = new RunStore();
const runId = store.saveRun(config, [{ strategyId, doc, summary, results, series, elapsedMs }], 'optional name');
store.listRuns();                 // newest first, with per-strategy means
store.getRun(runId);              // config, strategies with summary, results (series and logs stripped) and sampled series
store.deleteRun(runId);
store.close();
```

Two tables: `runs` (id, created_at, name, config JSON) and `run_strategies` (run_id, strategy_id, doc, summary, results, series, elapsed_ms), all JSON columns. Delete the file to start over; nothing else depends on it.
