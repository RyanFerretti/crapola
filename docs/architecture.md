# Architecture

Crapola is a Bun workspace with three packages and one app. Everything downstream of the engine treats it as a library; nothing in the engine knows about files, databases or HTTP.

```
packages/engine   game rules, strategy DSL, batch runner, statistics     (depends on zod only)
packages/store    strategy files on disk, saved runs in SQLite            (depends on engine)
packages/cli      bun run cli ...                                         (engine + store)
apps/web          Hono API + Vite/React UI                                (engine + store)
strategies/       the strategy bank: one JSON document per strategy
docs/             this folder
.claude/skills/   the import-video skill for Claude Code
```

## The engine, module by module

| module | responsibility |
|---|---|
| `rng.ts` | `SeededDice` (mulberry32), `FixedDice` for scripted rolls, `deriveSeed(base, i)` so session *i* of every strategy in a run sees the same dice, `parseRolls` for scripts like `"4 H8 6-6 7"` |
| `rules.ts` | `TableRules` and `DEFAULT_RULES`: minimum, odds policy, field pays, working defaults, vig policy, payout rounding |
| `bets.ts` | the `Bet` record, `resolveBet(bet, roll, point, isComeOut, rules)` for all 22 bet types, working logic, casino increments, odds maximums, selectors for picking bets off the table |
| `table.ts` | `TableState` and `applyRoll`: the point, shooter counters, hit counts, and the table-level events a roll produces |
| `player.ts` | `Player`: the rack, the bets on the table, and what the dealer accepts (`place`, `adjust`, `remove`, `setWorking`). All money movement for placing bets lives here |
| `events.ts` | `GameEvent`: everything a strategy can react to |
| `session.ts` | `Session`: the roll loop, bet resolution and payouts, decision points, exit handling, the narrated log and equity series |
| `strategy/types.ts` | the `Strategy` interface any strategy (DSL or TypeScript) implements, and the `ActionApi` a strategy gets at a decision point |
| `strategy/schema.ts` | the zod schema for strategy documents, and the JSON schema derived from it |
| `strategy/expr/` | the expression language: lexer, recursive-descent parser, evaluator, `interpolate` for log messages |
| `strategy/interpreter.ts` | validation beyond the schema (unknown identifiers, triggers, selectors), compilation of a document into a `Strategy`, and the runtime that evaluates rules and executes actions |
| `stats.ts` | per-strategy summary: mean, percentiles, win and bust rates, $/roll, edge, drawdown, histogram, head-to-head on identical dice |
| `batch.ts` | `runBatch`: N sessions with derived seeds, progress callback, optional equity series for the first few sessions |

## One roll, in order

`Session.run()` does this for every roll:

1. Draw dice from the dice source.
2. Resolve every bet on the table against the roll using the point **before** the roll (`resolveBet`). Pay wins into the rack, drop losers, move come bets to their numbers. Odds whose flat bet is gone (come odds that were off on a come-out seven) are returned.
3. Advance the table (`applyRoll`): set or clear the point, count the roll, detect seven-out and hand the dice to the next shooter.
4. Build the event list: `roll`, any table event (`pointEstablished`, `pointMade`, `sevenOut`, `natural`, `craps`), one bet event per resolved bet (`betWon`, `betLost`, `betPushed`, `betMoved`, `betReturned`), and `newShooter` when the dice passed.
5. Track equity for drawdown and check exit conditions.
6. If the session is not winding down, call the strategy's `decide(ctx)`. This is the **decision point**. The strategy places, presses, takes down and toggles bets through `ctx.api`, all of which take effect immediately and are logged.
7. Check exit conditions again, record the roll, repeat.

A first decision point happens before any dice are thrown, with the events `sessionStart` and `newShooter`.

## Exit handling

Exit conditions come from the run config, falling back to the strategy's `exit` block: `stopLoss`, `winGoal`, `maxShooters`, `maxRolls`, plus the strategy's own `walkAway`, running out of money, or running out of scripted dice. When one trips, the session **winds down**: removable bets come down (or ride, with `exitMode: "rideOut"`), contract bets (pass and come with a point) ride until they resolve, and the strategy is no longer consulted. `maxRolls` is the exception: it is a hard stop with no decision after the last roll. At the end every remaining stake comes back to the rack, so `profit` counts money on the table as yours.

A strategy that keeps asking for bets the rack cannot fund, with nothing on the table, for a full shooter ends as `busted` even if a few chips remain.

## Determinism

The engine never calls `Math.random`. A session is fully determined by its seed, the strategy, the run config and the table rules, so any session from a batch can be replayed roll by roll (`bun run cli play <id> --seed <seed>`). Within a run, session *i* uses `deriveSeed(baseSeed, i)` for every strategy, which is what makes the head-to-head matrix meaningful: the strategies saw identical rolls.

## Money conventions

- Whole dollars. Payouts are floored like a real table (`payoutRounding: "floor"`); `"exact"` keeps cents.
- Buy and lay commission is charged on each win by default. With `"up-front"` it is paid when the bet goes up or is pressed, refunded if taken down, and lost with the bet.
- Place, buy and hardway bets are off on the come-out unless the strategy calls them on. Lay bets and don't odds always work. Come odds are off on the come-out. All configurable in `TableRules`.
- `totalWagered` counts each dollar when it goes onto the table, so a place bet that rides for ten rolls counts once. `edge` is mean loss over that figure.

## The DSL runtime

`loadStrategy(doc)` validates the document (schema, then identifiers, functions, triggers and selectors) and compiles it into a `Strategy` whose `createSession()` returns a `DslSession`. At each decision point the session:

1. Checks whether it is sitting out or has walked away.
2. For each rule in order: works out how many times it fires (once for plain triggers, once per matching bet for bet triggers, honoring `once`), evaluates `when` with that bet bound, then evaluates every action's own `when` against the state before any action runs, and executes the enabled actions in order.
3. Stops early on `sitOut`, `walkAway`, or a rule with `stop: true`.

Expressions are parsed once and cached. Variables live on the session and show up in the narrated log's `state`.

## Store

`StrategyLibrary` reads and writes `strategies/<id>.json`, validating on both read and write. Invalid files are listed with their issues (and the raw JSON) so the editor can repair them. `RunStore` keeps batch results in SQLite (`data/crapola.sqlite`, gitignored) as two tables: `runs` (config, name, time) and `run_strategies` (summary, per-session results without series or logs, sampled equity series).

## Web

The Hono server is a thin layer over the two stores and the engine. Batch runs are jobs: one Bun `Worker` per strategy runs `runBatch` and posts progress; the job manager fans progress out over SSE and saves the run when all workers finish. The Vite dev server proxies `/api` to the Hono port; the production build is served by Hono from `apps/web/dist`. State on the client is React state plus a hash router; there is no global store.
