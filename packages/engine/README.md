# @crapola/engine

The game and the strategy language, with no I/O. Import it from scripts, tests, the CLI or the web server.

```ts
import { loadStrategy, runSession, runBatch, parseRolls, summarize, headToHead } from '@crapola/engine';

const { strategy } = loadStrategy(JSON.parse(await Bun.file('strategies/place-6-8.json').text()));

// one narrated session on scripted dice
const one = runSession(strategy, { bankroll: 300, fixedRolls: parseRolls('4 6 8 7'), recordLog: true });
console.log(one.profit, one.log?.map((l) => l.trace));

// ten thousand sessions, ten shooters each
const batch = runBatch(strategy, { sessions: 10_000, bankroll: 300, maxShooters: 10, seed: 42 });
console.log(batch.summary.mean, batch.summary.winRate);
```

## Main entry points

| export | what |
|---|---|
| `loadStrategy(doc)` | validate and compile a JSON document; throws `StrategyValidationError` with a list of issues |
| `validateStrategyDoc(doc)` | the same check without compiling, for editors |
| `runSession(strategy, config)` | one session; `config` is `RunConfig`: `bankroll`, `unit`, `rules`, `seed`, `fixedRolls`, `maxShooters`, `maxRolls`, `stopLoss`, `winGoal`, `exitMode`, `recordLog`, `recordSeries` |
| `runBatch(strategy, config)` | N sessions on derived seeds with a progress callback; returns results and a `StrategySummary` |
| `summarize(id, results)`, `headToHead(a, b)` | statistics over session results |
| `parseRolls(script)` | `"4 H8 6-6 7"` to dice pairs |
| `SeededDice`, `FixedDice`, `deriveSeed` | dice sources |
| `DEFAULT_RULES`, `mergeRules` | table rules |
| `resolveBet`, `isBetWorking`, `maxOdds`, `betIncrement` | the bet math, usable on its own |
| `STRATEGY_JSON_SCHEMA` | JSON schema for editors and LLM structured output |
| `BUILTIN_IDS`, `BUILTIN_FNS`, `BET_TYPES`, `EVENT_KINDS` | vocabularies for UIs and validation |

## Writing a strategy in TypeScript

```ts
import type { Strategy } from '@crapola/engine';

export const placeAndPress: Strategy = {
  id: 'place-and-press',
  name: 'Place 6/8, press once',
  unit: 6,
  createSession: () => ({
    decide({ table, player, api, events }) {
      if (table.point !== null) {
        for (const n of [6, 8]) if (!player.bets.some((b) => b.type === 'place' && b.number === n)) api.bet({ type: 'place', number: n, amount: 12 });
      }
      for (const e of events) {
        if (e.kind === 'betWon' && e.bet.type === 'place' && e.bet.amount < 24) {
          const live = player.bets.find((b) => b.id === e.bet.id);
          if (live) api.adjust(live, live.amount + e.payout - (e.payout % 6));
        }
      }
    },
  }),
};
```

`decide` is called at every decision point with the events since the last one, the table, the player (read-only by convention), the rules, the unit, and the `ActionApi`: `bet`, `select`, `remove`, `adjust`, `setWorking`, `walkAway`, `log`. Note that `api.bet` stacks on an existing same-slot bet; check first if you mean "ensure".

## Tests

```
bun test packages/engine
```

`bets.test.ts` is a payout table for every bet, `edge.test.ts` checks simulated house edges against known values, `session.test.ts` covers accounting and exit rules, `dsl.test.ts` covers the language, `coverage.test.ts` places all 22 bet types through JSON.
