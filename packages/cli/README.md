# @crapola/cli

`bun run cli <command>` from the repo root. `bun run cli help` prints every command and flag.

| command | what |
|---|---|
| `list` | the strategy bank with bet types, tags, source and validity (`--json` for machines) |
| `validate <id\|file>` | schema plus identifier, trigger and selector checks |
| `run <id> [id...]` | simulate; all strategies see the same dice; `--sessions`, `--bankroll`, `--shooters`, `--seed`, `--unit`, `--rolls`, `--stop-loss`, `--win-goal`, `--table-min`, `--odds`, `--save [name]`, `--csv file`, `--json` |
| `compare` | alias of `run` |
| `play <id>` | one narrated session; `--dice "4 H8 6-6 7"`, `--seed`, `--shooters`, `--bankroll`, `--json` |
| `transcript <url\|id>` | YouTube captions as timestamped text; `--out file`, `--json` |
| `runs` | saved runs in `data/crapola.sqlite` |
| `export <runId> <file.csv>` | per-session rows of a saved run |
| `schema` | the strategy JSON schema |
| `docs` | the DSL reference |

`src/transcript.ts` (yt-dlp through `uvx`, caption parsing, caching) and `src/format.ts` (tables, money, sparklines) are plain modules the web server also imports.
