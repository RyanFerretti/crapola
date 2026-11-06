# Extending crapola

Where to change things, and what else has to move with them. Run `bun test` and `bunx tsc -p tsconfig.json --noEmit` after each step.

## Add a table rule

1. Add the field to `TableRules` and `DEFAULT_RULES` in `packages/engine/src/rules.ts`.
2. Mirror it in `TableOverridesSchema` in `strategy/schema.ts` so strategy documents can set it.
3. Use it where it applies (`bets.ts` for payouts and working, `player.ts` for what the dealer accepts).
4. Add a CLI flag in `packages/cli/src/index.ts` (`tableRules()`) and a field on the run form in `apps/web/src/pages/RunPage.tsx` if runs should be able to override it.
5. Document it in `docs/strategy-dsl.md` (top-level `table` field) and, if it changes money, in the README's "How a simulation works".

## Add a bet type

1. Add the name to `BetType` and `BET_TYPES` in `bets.ts`, and to the right sets (`ONE_ROLL_TYPES`, `PROP_TYPES`, `NUMBERED_TYPES`, `MIN_BET_TYPES`).
2. Write its branch in `resolveBet`. Return `win` with the net payout and whether the bet comes down, `lose`, `push`, `move`, or `none`. Payout multipliers that vary by casino go in `PropPayouts`.
3. Teach `isBetWorking` its come-out behavior if it is a multi-roll bet, `betIncrement` its sensible step, and `describeBet` its name.
4. Let the dealer accept it: `Player.place` needs a branch if it has a slot rule (one per number, one per table, needs a base bet).
5. Tests: a resolution table in `packages/engine/test/bets.test.ts`, an edge check in `edge.test.ts` if the house edge is known, and add it to the kitchen-sink document in `coverage.test.ts`.
6. Docs: the `type` row in `docs/strategy-dsl.md`, the cheat sheet in the import skill, and the bet-type select in `apps/web/src/components/ActionEditor.tsx` picks it up from `/api/reference` automatically.

## Add a trigger

Triggers are event kinds. Add the event to `GameEvent` and `EVENT_KINDS` in `events.ts`, emit it from `session.ts` (table events come from `table.ts`), and if it carries a bet make sure it has a `bet` field so `betWon:place:6`-style filters work. Pseudo-triggers that describe state rather than events (`comeOut`, `pointOn`) are handled in `DslSession.instances`. Document it in the triggers table.

## Add an action

1. Add a zod object to `strategy/schema.ts` and include it in `ActionSchema`.
2. Validate its expressions and selectors in `validateStrategyDoc` (`interpreter.ts`).
3. Implement it in `DslSession.execute`. Actions should go through `ctx.api` so they are logged and respect the dealer's rules; the `ActionApi` is in `strategy/types.ts` and implemented by `Session.makeApi`.
4. Add a test in `test/dsl.test.ts` that plays scripted dice through it.
5. Document it in `docs/strategy-dsl.md`, add it to the import skill's cheat sheet if a video would phrase it, and add its fields to `apps/web/src/components/ActionEditor.tsx`.

## Add an expression identifier or function

Identifiers live in `BUILTIN_IDS` (name and one-line description, which the UI's Reference tab shows) and `makeScope().get`; functions in `BUILTIN_FNS` and `makeScope().call`, all in `interpreter.ts`. The validator only accepts names in those maps, so adding the entry is what makes it legal. Document it in the expressions tables.

## Add a statistic

`summarize` in `stats.ts` builds `StrategySummary`. Add the field there, then to the CLI table in `packages/cli/src/format.ts` and the summary table in `apps/web/src/pages/RunDetail.tsx`. Saved runs store the summary as JSON, so old runs will simply lack the new field.

## Add a web page

Pages are components in `apps/web/src/pages/` registered in the hash router (`src/App.tsx`, `src/router.ts`). API calls go through `src/api.ts`; add a route in `apps/web/server/index.ts` next to the others. Charts live in `src/charts/` on Recharts with the palette in `src/theme.ts`.

## Change the strategy document format

Bump nothing lightly. If a change is additive (a new optional field), keep `version: 1`. If existing files would stop validating, add migration code in `StrategyLibrary.read` keyed on `version` before you change the schema, and run `bun run cli list` to confirm every file in the bank still loads.

## Keep these in sync

| when you change | also update |
|---|---|
| anything in the DSL | `docs/strategy-dsl.md`, `.claude/skills/import-video/SKILL.md` cheat sheet, the web ActionEditor |
| money or working conventions | README "How a simulation works", `docs/architecture.md` |
| CLI flags | the `HELP` string in `packages/cli/src/index.ts` and the README CLI section |
| API routes | `apps/web/README.md`, `apps/web/src/api.ts` |
