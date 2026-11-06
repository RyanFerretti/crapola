# crapola web

Local UI for the strategy bank and simulator. Hono API on Bun plus a Vite + React front end. Nothing here is meant to be deployed; it reads `strategies/` and `data/crapola.sqlite` from the repo.

```
bun run web          # from the repo root: API on :4242 and the Vite dev server on :5173 (or the next free port)
bun run web:build    # production bundle into apps/web/dist
bun run web:start    # serve the built UI and the API together on :4242
```

Per the house rule for long-running processes, start it in tmux:

```
tmux new-session -d -s crapola-web "cd $(pwd) && bun run web"
tmux attach -t crapola-web        # Ctrl+B then D to detach
tmux capture-pane -t crapola-web -p | tail -n 20
```

## Pages

- **Strategies**: every file in `strategies/`, with tags, source and validity. New, open, run or play from the cards.
- **Strategy editor**: a form-based rule builder (triggers, condition, once-per, ordered actions with type-specific fields), a Raw JSON tab kept in sync both ways with live validation, and a Reference tab with the DSL docs, identifiers and functions. The Play drawer narrates one session roll by roll with scripted or seeded dice and an equity sparkline.
- **Run**: pick strategies, set bankroll, sessions, shooters, seed, goals and table rules, launch. Each strategy runs in its own worker; progress streams over SSE.
- **Results**: saved runs. A run shows the summary table, profit histograms, equity-through-session lines for sampled sessions, end reasons and the head-to-head matrix on identical dice. Re-run with the same config or delete.
- **Import**: how to use the `/import-video` Claude Code skill, plus a transcript viewer for any YouTube URL.

## API

All routes are under `/api`.

| route | purpose |
|---|---|
| `GET /strategies`, `GET /strategies/:id`, `POST /strategies`, `PUT /strategies/:id`, `DELETE /strategies/:id` | strategy bank (files in `strategies/`) |
| `POST /validate` | validate a document without saving |
| `GET /reference` | DSL identifiers, functions, bet types, triggers, JSON schema and the markdown reference |
| `POST /play` | one narrated session (`strategyId` or `doc`, `dice`, `bankroll`, `seed`, `shooters`, `rolls`, goals, table rules) |
| `POST /runs` | start a batch job; returns the job id |
| `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/events` | job status, and an SSE stream of it |
| `GET /runs`, `GET /runs/:id`, `DELETE /runs/:id` | saved runs in `data/crapola.sqlite` |
| `GET /transcript?url=` | YouTube captions as timestamped text (yt-dlp via `uvx`) |

## Layout

```
server/index.ts        Hono app, static serving of dist/
server/jobs.ts         job manager: one Bun Worker per strategy, SSE fan-out
server/batch-worker.ts runs runBatch in a worker and posts progress
scripts/dev.ts         starts the API (--hot) and Vite together
src/pages/             Strategies, StrategyEditor, RunPage, RunsHistory, RunDetail, ImportPage
src/components/        RuleEditor, ActionEditor, PlayDrawer, ui primitives
src/charts/            Histogram, EquityLines, EndReasons (Recharts)
src/api.ts             typed client for the routes above
src/styles.css         tokens, light and dark via prefers-color-scheme
```
