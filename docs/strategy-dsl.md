# Crapola strategy DSL

A strategy is one JSON document. The engine evaluates its `rules` at every **decision point**: once at session start and once after every roll (after bets are paid). Rules run top to bottom. Each rule says *when* it fires (`on` + `when`) and *what* it does (`do`).

```json
{
  "version": 1,
  "id": "pass-line-max-odds",
  "name": "Pass line with max odds",
  "description": "One pass line bet, 3-4-5x odds behind it.",
  "tags": ["classic", "right-side"],
  "unit": 10,
  "bankroll": 500,
  "table": { "minBet": 10, "oddsPolicy": "3-4-5x" },
  "exit": { "stopLoss": 300, "winGoal": 300 },
  "variables": {},
  "rules": [
    { "on": "comeOut", "do": [{ "action": "bet", "type": "pass", "amount": "1u" }] },
    { "on": "pointEstablished", "do": [{ "action": "bet", "type": "odds", "on": "pass", "max": true }] }
  ]
}
```

## Top-level fields

| field | meaning |
|---|---|
| `version` | always `1` |
| `id` | lowercase slug, also the file name (`strategies/<id>.json`) |
| `name`, `description`, `author`, `tags` | metadata |
| `source` | where it came from: `{ "type": "youtube", "url", "videoId", "title", "channel", "importedAt", "notes" }` |
| `unit` | base betting unit; `"2u"` in any amount means `2 * unit`. The run can override it. |
| `bankroll` | suggested buy-in (default for runs) |
| `table` | table rule overrides: `minBet`, `maxBet`, `oddsPolicy`, `fieldPays`, `placeWorkingOnComeOut`, `hardwaysWorkingOnComeOut`, `buyVig`, `layVig`, ... |
| `exit` | session limits: `stopLoss`, `winGoal`, `maxShooters`, `maxRolls`, `exitMode` (`takeDown` or `rideOut`). Run options override these. |
| `variables` | named numbers/strings/booleans the rules can read and change |
| `rounding` | default rounding of amounts to casino increments: `up` (default), `down`, `nearest`, `none` |
| `rules` | the strategy |
| `notes` | importer notes: assumptions and ambiguities |

## Rules

```json
{
  "id": "press-the-six",
  "description": "Press the 6 with its winnings after it hits twice",
  "on": "betWon:place:6",
  "when": "hitsSincePoint(6) >= 2",
  "once": "point",
  "do": [{ "action": "press", "target": "self" }]
}
```

- `on`: a trigger or list of triggers. Omit it to evaluate the rule at **every** decision point (pair that with `when`, and remember `bet` actions default to *ensure*, so repeating them is harmless).
- `when`: an expression that must be truthy.
- `once`: fire at most once per `shooter`, `point` (while a point is on, or during one come-out stretch), `session`, or `roll` (decision point).
- `stop: true`: when this rule fires, skip the remaining rules at this decision point. Together with `when` this gives if/else chains.
- `enabled: false` turns a rule off.
- Every action may carry its own `when`. All of a rule's action conditions are evaluated **before** any of its actions run, against the state the rule saw, so a list of them reads as if/else: `"do": [{ "action": "bet", ..., "when": "!hasBet('place', 9)" }, { "action": "press", ..., "when": "hasBet('place', 9)" }]` places the 9 the first time and presses it afterwards, never both in one roll.

### Triggers

| trigger | fires |
|---|---|
| `sessionStart` | at the first decision point |
| `newShooter` | when a shooter gets the dice (also at session start) |
| `roll` | after every roll |
| `comeOut` | at any decision point where the point is **off** (the next roll is a come-out) |
| `pointOn` | at any decision point where the point is **on** |
| `pointEstablished` | the roll just set a point |
| `pointMade` | the shooter hit the point |
| `sevenOut` | the shooter sevened out (a `newShooter` fires at the same time) |
| `natural` | 7 or 11 on the come-out |
| `craps` | 2, 3 or 12 on the come-out |
| `betWon`, `betLost`, `betPushed`, `betMoved`, `betReturned` | per bet; filter with `:type` and `:number`, e.g. `betWon:place:6`, `betLost:dontCome`, `betMoved:come` (a come bet travelled to a number) |

Bet triggers fire **once per matching bet**, with that bet available to `when`, amounts and the `self` selector as `bet.type`, `bet.number`, `bet.amount`, `bet.payout` (net win), `bet.on`.

Rules with several plain triggers fire once per decision point even if more than one matches.

## Expressions

Amounts and conditions are strings in a small expression language: numbers, `"2u"` (units), strings, `+ - * / %`, comparisons, `&& || !`, `cond ? a : b`, function calls.

Identifiers:

| name | value |
|---|---|
| `unit` | base unit |
| `bankroll` | chips in the rack |
| `equity` | bankroll plus money on the table |
| `startBankroll`, `profit` | starting bankroll, equity minus it |
| `shooterProfit`, `pointProfit` | equity change since this shooter / since the point was set |
| `onTable` | total staked right now |
| `peakEquity`, `drawdown` | high-water mark and distance below it |
| `point` | current point, 0 when off |
| `pointOn`, `pointOff`, `comeOut` | booleans |
| `lastRoll`, `lastHard`, `die1`, `die2` | last roll total, whether it was a pair, the dice |
| `rollNumber`, `rollsThisShooter`, `rollsSincePoint` | counters |
| `shooter`, `shootersDone` | shooter number (1-based), shooters who sevened out |
| `pointsMadeThisShooter`, `pointsMade`, `sevenOuts`, `comeOutStreak` | counters |
| `rollWon`, `rollLost` | money won / lost on the last roll |
| `bet` | the triggering bet in bet-event rules |
| `minBet`, `maxBet` | table limits |
| any variable name | its current value |

Functions:

| call | value |
|---|---|
| `hasBet(type[, number])` | e.g. `hasBet('place', 6)`, `hasBet('come')`; number `0` means a come/don't come that has not travelled yet, so `betCount('dontCome') - betCount('dontCome', 0)` is the number of don't comes sitting on numbers |
| `betCount([type[, number]])` | how many such bets are up |
| `betAmount(type[, number])` | amount on that bet (0 if none) |
| `totalOn(type \| 'inside' \| 'outside' \| 'across' \| 'all')` | total staked |
| `hits(n)`, `hitsSincePoint(n)` | times `n` rolled this shooter / since the point |
| `rolled(a, b, ...)` | last roll was one of these |
| `won(type[, number])`, `lost(type[, number])` | such a bet won / lost on the last roll |
| `maxOdds(on[, number])` | max odds on that flat bet |
| `min`, `max`, `floor`, `ceil`, `round`, `abs` | math |
| `roundUp(x, inc)`, `roundDown(x, inc)` | to a multiple of `inc` |

## Actions

### `bet`

```json
{ "action": "bet", "type": "place", "numbers": "inside", "skipPoint": true, "amount": "1u" }
{ "action": "bet", "type": "odds", "on": "pass", "max": true }
{ "action": "bet", "type": "odds", "on": "come", "multiple": 2 }
{ "action": "bet", "type": "hardway", "number": 8, "amount": 5, "working": true }
{ "action": "bet", "type": "hop", "hop": [3, 4], "amount": 1 }
{ "action": "bet", "type": "place", "number": 6, "amount": 30, "mode": "set" }
{ "action": "bet", "type": "hardway", "number": "bet.number", "amount": "bet.payout", "mode": "add" }
```

| field | meaning |
|---|---|
| `type` | `pass`, `dontPass`, `come`, `dontCome`, `odds`, `place`, `buy`, `lay`, `field`, `hardway`, `anySeven`, `anyCraps`, `two`, `three`, `eleven`, `twelve`, `ce`, `horn`, `world`, `hop`, `big6`, `big8` |
| `number` / `numbers` | box number(s); `numbers` may be a list or `inside` (5 6 8 9), `outside` (4 5 9 10), `across` (4 5 6 8 9 10). `number` may also be an expression, e.g. `"bet.number"` in a bet-event rule or `"point"` |
| `skipPoint` | leave the point number out of `numbers` |
| `on` | odds only: `pass`, `come`, `dontPass`, `dontCome`. Without `number`, odds go on every such flat bet that has none. |
| `amount` | dollars or an expression; `multiple` (times the flat bet) and `max: true` are for odds |
| `mode` | `ensure` (default: only if the slot is empty), `add` (stack on top), `set` (press or regress to exactly this) |
| `working` | call the bet on/off regardless of table defaults |
| `rounding` | override the document rounding for this bet |
| `maxAmount` | ceiling, handy with `add` |

Amounts are rounded to casino increments by default (`up`): $6 steps on place 6/8, $5 on place 4/5/9/10, odds in steps that pay evenly, lay bets in $2/$3/$6 steps. Odds are capped at the table maximum and rounded down.

Engine conventions: place, buy and hardway bets are **off on the come-out** unless `working: true`; lay bets and don't odds are always on; come odds are off on the come-out. A pass bet while the point is on is a put bet. A come bet is only accepted while the point is on. Don't pass can't be made after the point. Same-slot bets merge: a second `add` on Place 6 presses it. Buy and lay commission is charged on each win by default (`table.buyVig` / `table.layVig: "on-win"`); with `"up-front"` it is paid once when the bet goes up, refunded if the bet is taken down, and lost with the bet.

### `press`

```json
{ "action": "press", "target": "self" }
{ "action": "press", "target": "place:8", "by": "winnings", "max": 60 }
{ "action": "press", "target": "inside", "by": "1u" }
```

`by`: `winnings` (default, the payout of the bet that just won), `half`, `full` (double it), or an amount. Rounds **down** to the increment (regardless of the document `rounding`) so you never press more than you won. `max` caps the resulting bet. To press *to* an exact amount use `regress` with `to`, or `bet` with `mode: "set"`; both move in either direction. A press the rack cannot fund is logged as a rejected bet.

### `regress`

```json
{ "action": "regress", "target": "across", "to": "1u" }
```

Sets every matching bet to `to` (0 takes it down).

### `takeDown`, `setWorking`

```json
{ "action": "takeDown", "target": "all" }
{ "action": "setWorking", "target": "place", "working": true }
{ "action": "setWorking", "target": "hardway", "working": null }
```

`working: null` restores the table default. Contract bets (pass/come with a point) can't come down.

### `set`, `increment`

```json
{ "action": "set", "var": "level", "value": 1 }
{ "action": "set", "var": "level", "value": "remainder > 0 ? 2 : 1" }
{ "action": "increment", "var": "losses", "by": 1 }
```

### `sitOut`, `walkAway`, `log`

```json
{ "action": "sitOut", "until": "nextShooter" }
{ "action": "sitOut", "until": "rolls", "rolls": 3 }
{ "action": "walkAway", "mode": "takeDown" }
{ "action": "log", "message": "pressing the 6 to {betAmount('place', 6)}" }
```

While sitting out no rules fire; existing bets stay as they are. `walkAway` ends the session (takeable bets come down, contracts ride) and no later rule runs.

A session also ends as `busted` when the strategy keeps asking for bets the rack cannot fund, with nothing on the table, for a full shooter. Strategies with a unit far above the table minimum should still add their own `walkAway` or `exit.stopLoss` if they want to leave earlier.

### Selectors

Targets are a shorthand string or an object:

- `self` / `this`: the bet that triggered the rule
- `all`, `inside`, `outside`, `across`, `props`, `removable`, `contracts`, `box`
- `place`, `place:6`, `place:inside`, `hardway:8`, `odds:come`, `odds:come:5`, `dontCome`
- `{ "type": ["place", "buy"], "numbers": [6, 8] }`, `{ "tag": "hedge" }`

## Common spreads

| phrase | bets |
|---|---|
| $22 inside | 5/9 $5, 6/8 $6 |
| $44 inside | 5/9 $10, 6/8 $12 |
| $66 inside | 5/9 $15, 6/8 $18 |
| $110 inside | 5/9 $25, 6/8 $30 |
| $32 across | 4/5/9/10 $5, 6/8 $6 |
| $64 across | 4/5/9/10 $10, 6/8 $12 |
| $160 across | 4/5/9/10 $25, 6/8 $30 |
| $27 across minus the point | $32 across without the point number |
| "press it" | `press` with winnings |
| "same bet" | leave it (default) |
| "take me down" / "down on everything" | `takeDown` |
| "regress to $22 inside" | `regress` target `inside` to the spread |
| "two hits and down" | `when: "hitsSincePoint(bet.number) >= 2"` then `takeDown self` |
| "hardways working" | `setWorking` hardway `true` |
| "off on the come-out" | the default for place/buy/hardways |
| "buy the 4 and 10" | `bet` type `buy` numbers [4, 10] |
| "lay the 4" | `bet` type `lay` number 4 |
| "a dollar each on the hardways" | `bet` hardway numbers [4, 6, 8, 10] amount 1 |

## Worked example: a Martingale don't

```json
{
  "version": 1,
  "id": "double-dont",
  "name": "Double up don't pass",
  "unit": 10,
  "variables": { "level": 1 },
  "rules": [
    { "on": "betLost:dontPass", "do": [{ "action": "increment", "var": "level" }] },
    { "on": "betWon:dontPass", "do": [{ "action": "set", "var": "level", "value": 1 }] },
    { "on": "comeOut", "when": "level <= 4", "do": [{ "action": "bet", "type": "dontPass", "amount": "unit * level" }] },
    { "on": "comeOut", "when": "level > 4", "do": [{ "action": "set", "var": "level", "value": 1 }, { "action": "sitOut", "until": "nextShooter" }] }
  ]
}
```

Rule order matters: the level is updated before the bet rule reads it.
