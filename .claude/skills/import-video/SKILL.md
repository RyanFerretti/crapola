---
name: import-video
description: Turn a YouTube craps strategy video (or any transcript) into a crapola strategy JSON file, validate it, sanity-check it with a narrated session and a batch run, and save it to strategies/. Use when the user gives a YouTube link or asks to import, translate, or encode a craps strategy.
---

# Import a craps strategy from a video

You are translating a human's spoken betting system into the crapola strategy DSL. The result is a JSON file in `strategies/<id>.json` that the engine can simulate thousands of times.

## Steps

1. **Fetch the transcript.**
   ```bash
   bun run cli transcript <url-or-id> --out tmp/transcripts/<videoId>.txt
   ```
   Read the whole file. Crappy (and most strategy YouTubers) explain the system in the first 2 to 4 minutes, then play it live for 20 minutes. The live play is where the real rules show up: pressing, regressions, when they turn bets off, what they do after a seven-out, when they walk. Read all of it.

2. **Read the DSL reference** at `docs/strategy-dsl.md` (or `bun run cli docs`). Look at two or three existing files in `strategies/` for style.

3. **Write down the system in plain English first**, as a numbered list of rules keyed to table state: come-out, point established, after a hit, after a seven-out, new shooter, bankroll goals. Resolve every amount into dollars (see the "Common spreads" table in the reference). Note the table minimum the video uses and the buy-in.

4. **Translate into JSON.** Conventions:
   - `id`: lowercase slug of the strategy name, prefixed with the channel nickname if useful (`crappy-sweet-49`).
   - `source`: `{ "type": "youtube", "url", "videoId", "title", "channel", "importedAt": "<ISO date>" }`.
   - `unit`: the smallest bet the video repeats; `bankroll`: the buy-in they mention; `table.minBet`: the table they play.
   - Put the **state-updating rules before the betting rules** (rules run in order).
   - Prefer `on` triggers (`pointEstablished`, `betWon:place:6`, `sevenOut`, `newShooter`) over bare `when` rules.
   - `bet` defaults to *ensure* (only if that slot is empty), so repeating a bet rule every roll is fine.
   - Amounts in dollars when the video says dollars; `"Nu"` when it talks in units.
   - When the video is vague (how many hits before pressing, when to leave), pick the most common interpretation and record it under `notes`.
   - Keep `exit` for the goals the video states (win goal, stop loss, "I play N shooters").

5. **Validate and watch it play.**
   ```bash
   bun run cli validate strategies/<id>.json
   bun run cli play <id> --dice "4 6 8 6 6 7"         # scripted dice through the key situations
   bun run cli play <id> --seed 3 --shooters 3          # a random session
   ```
   Check the narrated log line by line: are the right bets up at the right time, with the right amounts, working/off when the video says so? Fix and repeat. Rejected bets in the log mean the DSL asked for something the table refuses (below minimum, odds over the max, come bet on a come-out).

6. **Run a batch** to make sure nothing explodes and the numbers look sane.
   ```bash
   bun run cli run <id> --sessions 2000
   ```
   `rejectedBets` should be zero or explained. Compare against `pass-line-max-odds` if useful.

7. **Report**: the file path, a short bullet list of the rules as implemented, the assumptions in `notes`, and the batch summary line (mean, win rate, bust rate).

## Translation cheat sheet

| they say | DSL |
|---|---|
| "$44 inside" | `bet` place `numbers: "inside"`, amount 10 on 5/9 and 12 on 6/8: use two actions, or `amount: 12` with rounding `up` for 6/8 and a second action for 5/9 |
| "$32 across minus the point" | place `numbers: "across"`, `skipPoint: true`, 5 on outside / 6 on 6-8 (two actions) |
| "press it" / "press the six" | `on: "betWon:place:6"`, `press` target `self` |
| "same bet" | nothing |
| "take it down" / "down on everything" | `takeDown` |
| "regress to $22 inside" | `regress` target `inside` to 5 (and 6 on 6/8 via a second regress on `place:6`/`place:8`) |
| "two hits and down" | `when: "hitsSincePoint(bet.number) >= 2"` + `takeDown self` |
| "hardways working" / "turn them on" | `setWorking` target `hardway` working true |
| "buy the 4 and 10 for $25" | `bet` buy numbers [4, 10] amount 25 |
| "lay the 4 for $40" | `bet` lay number 4 amount 40 |
| "don't come with lay odds" | `bet` dontCome, then on `betMoved:dontCome` `bet` odds on dontCome |
| "put $5 on the hard 8" | `bet` hardway number 8 amount 5 |
| "yo" / "eleven" | type `eleven`; "C and E" is `ce`; "any seven" is `anySeven`; "horn" is `horn` |
| "hop the sevens" | three `hop` bets: [1,6], [2,5], [3,4] |
| "off on the come-out" | default for place/buy/hardways; say nothing |
| "working on the come-out" | `working: true` on the bet or `setWorking` |
| "I want to win $300 and leave" | `exit.winGoal: 300` |
| "if I lose $500 I'm done" | `exit.stopLoss: 500` |
| "after the seven, I wait for a point before I bet" | `on: "pointEstablished"` instead of `pointOn` |

## Pitfalls

- A come bet cannot be made on a come-out roll; use the pass line there.
- Don't pass cannot be added after a point is set.
- Place 6/8 amounts must be multiples of 6 for full pay; the engine rounds up by default.
- Odds are capped at the table max; `max: true` is the usual intent of "full odds".
- `press` rounds down so you never put in more than you won; use `by: "full"` for "double it".
- A rule without `on` runs at every decision point including session start.
