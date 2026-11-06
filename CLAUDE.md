# crapola

Craps strategy engine + simulator. TypeScript on Bun. Workspaces: `packages/engine` (pure game logic + strategy DSL), `packages/store` (strategy files + SQLite runs), `packages/cli`, `apps/web` (Vite + React + Hono).

## Commands

- `bun test` runs the engine tests (includes Monte Carlo house-edge checks; ~10 s).
- `bunx tsc -p tsconfig.json --noEmit` typechecks every workspace.
- `bun run cli <command>`; `bun run cli help` lists everything.
- `bun run web` starts the API (4242) and UI (5173); use the tmux session `crapola-web`.

## Conventions

- Strategies are JSON files in `strategies/<id>.json`, one per strategy, validated by `validateStrategyDoc`. The DSL reference is `docs/strategy-dsl.md`; keep it in sync with `packages/engine/src/strategy/schema.ts` and `interpreter.ts` when adding triggers, actions, identifiers or functions.
- The engine must stay deterministic: never use `Math.random` inside `packages/engine`. Dice come from `SeededDice`/`FixedDice`.
- Money is whole dollars; payouts floor by default (`payoutRounding`).
- Bet resolution lives in `packages/engine/src/bets.ts`; table-state transitions in `table.ts`; bankroll and bet placement rules (what the dealer accepts) in `player.ts`; the roll loop and exit logic in `session.ts`.
- Add a test in `packages/engine/test/` for any new bet type or payout rule, and an edge check if the house edge is known.
- Imported strategies carry `source` metadata and a `notes` field with the importer's assumptions. Don't silently change an imported strategy's rules; add a note.
- Temporary files go in `tmp/` (gitignored). Transcript caches live in `tmp/transcripts/`.
