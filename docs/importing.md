# Importing strategies from YouTube

The import path turns a strategy video into a document in `strategies/`. It is a Claude Code skill, not a background service: you run it in a Claude Code session inside this repo, read along, and end up with a validated, test-played file plus a list of the assumptions that had to be made.

## Requirements

- `uv` on your PATH (the transcript fetcher runs yt-dlp through `uvx`, so nothing else needs installing): https://docs.astral.sh/uv/
- The video needs English captions. Auto-generated captions are fine and are what most strategy channels have.

## Running it

In Claude Code, from the repo root:

```
/import-video https://www.youtube.com/watch?v=pC3Xdger1WY
```

What the skill does, in order (the full instructions are in `.claude/skills/import-video/SKILL.md`):

1. Fetches the transcript with `bun run cli transcript <url> --out tmp/transcripts/<id>.txt` and reads all of it. The system is usually explained in the first few minutes, but the live play that follows is where the real rules show up: when they press, when they regress, what they do after a seven, when they leave.
2. Reads the DSL reference and a couple of existing strategies for style.
3. Writes the system as numbered English rules keyed to table state, with every amount in dollars.
4. Translates that into a document with `source` metadata and a `notes` field for assumptions.
5. Validates it, plays it through scripted dice covering the key situations, plays a random session, and fixes the JSON until the narration matches the video.
6. Runs a batch and checks for rejected bets.
7. Reports the rules as implemented, the assumptions, and the batch summary.

Expect a handful of minutes per video and a few rounds of fixing. Read the report: the assumptions are the part that matters, because a 25-minute video rarely states a complete system. Typical gaps are how many hits before pressing, what happens when the rack is short, and when to leave.

## Transcripts by hand

```
bun run cli transcript <url or id>                   # prints timestamped text
bun run cli transcript <url or id> --out file.txt
bun run cli transcript <url or id> --json            # segments, title, channel, duration
```

Captions are cached in `tmp/transcripts/` (gitignored), so a second import of the same video does not hit YouTube again. YouTube rate-limits caption downloads after a burst of about fifteen videos; the fetcher backs off and retries, and tells you to wait if it still fails.

The web UI's **Import** page has the same transcript viewer for reading along.

## What auto-captions get wrong

Auto-captions mis-hear craps vocabulary constantly, and the skill knows the common ones:

| captions say | he said |
|---|---|
| "yo", "you" | both; "yo" is also the eleven |
| "the dome", "the dough", "donuts" | the don't |
| "30.68", "thirty sixty eight" | $30 six and eight |
| "hard aid", "heart eight" | hard 8 |
| "lay" vs "play" | often swapped |
| "press it" vs "pressing" | the same instruction |

When the numbers are unclear, the skill reconciles them against the payouts the player calls out ($14 on a $12 six, $35 on a $30 six, $49 on a $35 nine, $224 on a $192 eight), which captions get right more often than the bet sizes.

## What the DSL cannot say

Things that have come up and were left out, with the reason:

- Dealer tips ("a dollar for the boys"). No money leaves the rack without a bet behind it. Cost is about a dollar per shooter; noted, not modeled.
- Shooter identity ("when I'm shooting I hop the twelve"). The engine does not know who holds the dice.
- Clock-based sessions ("twenty minutes then I leave"). Use shooters or rolls.
- Pure discretion ("take it down when it feels right"). The skill picks the player's observed behavior and records the alternative in `notes`.

## After an import

The document is in `strategies/<id>.json` with `source.type: "youtube"`. Treat `notes` as part of the strategy: if you change a rule because you read the video differently, add a line saying so rather than silently editing. Re-run `bun run cli validate` and a batch after any edit.
