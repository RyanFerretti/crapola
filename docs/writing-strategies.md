# Writing strategies

Three ways to get a strategy into the bank: write the JSON by hand, build it in the web UI, or import it from a video with the Claude Code skill. All three produce the same kind of file in `strategies/`, so you can start one way and finish another.

The language reference is [strategy-dsl.md](strategy-dsl.md). This page is the how-to.

## Think in decision points

The engine asks your strategy what to do once before the first roll and once after every roll. At that moment you know the point, what just rolled, which bets won or lost, how much is in the rack, and anything you stored in variables. Rules run top to bottom, so put the rules that update state above the rules that bet with it.

Write the system down in English first, as a numbered list keyed to table state:

1. Come-out: what goes up?
2. Point established: what goes up, and does the point number matter?
3. A number hits: collect, press, or spread?
4. Seven-out: anything to reset?
5. New shooter: any per-shooter budget?
6. When do you leave?

Each line becomes one rule.

## Patterns

**Bet once, leave it.** `bet` defaults to *ensure*, so a rule on `pointOn` that places the 6 and 8 is harmless to evaluate every roll; it only acts when the slot is empty.

```json
{ "on": "pointOn", "do": [{ "action": "bet", "type": "place", "numbers": [6, 8], "amount": "2u" }] }
```

**Press with the winnings.** Bet triggers fire once per winning bet and bind it as `self`.

```json
{ "on": "betWon:place", "do": [{ "action": "press", "target": "self" }] }
```

**Press N times then collect.** Compare against the amount.

```json
{ "on": "betWon:place:6", "when": "bet.amount < 42", "do": [{ "action": "press", "target": "self" }] }
```

**A payout ladder (if/else).** Give each action its own `when`; they are all evaluated against the state before any of them run.

```json
{
  "on": "betWon:place",
  "do": [
    { "action": "bet", "type": "place", "number": 9, "amount": 10, "when": "!hasBet('place', 9)" },
    { "action": "bet", "type": "place", "number": 5, "amount": 10, "when": "hasBet('place', 9) && !hasBet('place', 5)" },
    { "action": "press", "target": "self", "when": "hasBet('place', 9) && hasBet('place', 5)" }
  ]
}
```

**Progressions.** Keep the level in a variable; update it on bet events before the betting rule.

```json
{ "on": "betLost:dontPass", "do": [{ "action": "increment", "var": "level" }] },
{ "on": "betWon:dontPass",  "do": [{ "action": "set", "var": "level", "value": 1 }] },
{ "on": "comeOut", "do": [{ "action": "bet", "type": "dontPass", "amount": "unit * level" }] }
```

**Per-shooter budgets.** Reset on `newShooter`, decrement inside the betting rule, gate with `when`.

**Regress after a hit.** `regress` sets an exact amount in either direction.

```json
{ "on": "betWon:place", "when": "bet.amount > 30", "do": [{ "action": "regress", "target": "self", "to": 30 }] }
```

**Odds.** `max: true` for full odds; `multiple` for "double odds"; bare `amount` when the video states dollars. `on: "come"` without a number puts odds on every come bet that has none, so pair it with `betMoved:come`.

**Working on the come-out.** Place, buy and hardways are off on the come-out by default. Say `"working": true` on the bet, or flip them with `setWorking`.

**Leaving.** Prefer `exit.winGoal` / `exit.stopLoss` for stated goals. Use a `walkAway` rule for conditions the goals can't express (for example "if I can't fund the next step").

## Amounts

- Dollars when the source talks in dollars (`"amount": 30`). Units when it talks in units (`"amount": "2u"`); runs can then rescale with `--unit`.
- The engine rounds to casino increments (up by default): $6 steps on the 6 and 8, $5 on the other place numbers, odds in steps that pay evenly. `press` always rounds **down** so you never press more than you won.
- A bet the table refuses (below the minimum, odds over the max, a come bet on the come-out, more than the rack holds) is logged as `rejected` and counted in `rejectedBets`. A finished strategy should show zero in a batch, or explain why in `notes`.

## Watch it play

```
bun run cli play <id> --dice "4 6 8 6 5 9 7"      # the situations you care about
bun run cli play <id> --seed 3 --shooters 3         # a random session
```

The narration shows each roll, what resolved, what the strategy did (in order, with `log` messages interleaved), the variables, and the rack / table / equity after. Read it like a dealer would: are the right bets up, at the right size, on or off when they should be?

Then run a batch and look at `rejectedBets`, the end reasons, and whether the shape of the histogram matches what the system should do (a progression has a fat left tail; a press ladder has a long right one).

```
bun run cli run <id> --sessions 5000
bun run cli compare <id> pass-line-max-odds
```

## In the web UI

Strategies, then **+ New strategy**. The Builder tab is the same document as a form: metadata and money on the right, rules on the left with triggers, condition, once-per and an ordered list of actions. The Raw JSON tab is the file itself with live validation; edits in either tab update the other. **Play** opens the narrated session drawer; **Run batch** goes to the run page with this strategy ticked. Saving writes `strategies/<id>.json`, so the CLI sees it immediately.

## Document hygiene

- `id` is a lowercase slug and the file name.
- Fill `description` as one or two sentences a person could play from.
- `tags`: at least a side (`right-side`, `dark-side`, `hedge`) and the bet family (`place`, `press`, `props`, `progression`).
- `source` says where it came from; `notes` lists every assumption, ambiguity and anything deliberately left out. Future you will want both.
- A strategy in TypeScript instead of JSON is fine when the DSL can't say it: implement `Strategy` from `@crapola/engine` (see `packages/engine/test/session.test.ts` for small examples) and pass it to `runSession` or `runBatch` from a script.
