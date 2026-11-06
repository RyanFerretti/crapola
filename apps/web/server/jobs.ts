import type { BatchConfig, SessionResult, StrategyDoc, StrategySummary } from '@crapola/engine';
import type { RunStore, SavedStrategyRun } from '@crapola/store';

export type JobConfig = Omit<BatchConfig, 'onProgress'>;

export interface JobState {
  id: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  strategyIds: string[];
  progress: Record<string, { done: number; total: number }>;
  runId?: number;
  error?: string;
}

type Listener = (state: JobState) => void;

interface Job {
  state: JobState;
  listeners: Set<Listener>;
}

interface WorkerDone {
  summary: StrategySummary;
  results: SessionResult[];
  elapsedMs: number;
}

/** Runs one batch per strategy in parallel workers, then saves the run. */
export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private seq = 0;

  constructor(private readonly store: RunStore) {}

  get(id: string): JobState | undefined {
    return this.jobs.get(id)?.state;
  }

  list(): JobState[] {
    return [...this.jobs.values()].map((j) => j.state);
  }

  subscribe(id: string, fn: Listener): () => void {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    job.listeners.add(fn);
    return () => job.listeners.delete(fn);
  }

  private emit(job: Job): void {
    for (const fn of job.listeners) fn(job.state);
  }

  start(docs: StrategyDoc[], config: JobConfig, name?: string): JobState {
    const id = `${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
    const job: Job = {
      state: {
        id,
        status: 'running',
        startedAt: new Date().toISOString(),
        strategyIds: docs.map((d) => d.id),
        progress: Object.fromEntries(docs.map((d) => [d.id, { done: 0, total: config.sessions }])),
      },
      listeners: new Set(),
    };
    this.jobs.set(id, job);

    const runs = docs.map(
      (doc) =>
        new Promise<SavedStrategyRun>((resolveRun, reject) => {
          const worker = new Worker(new URL('./batch-worker.ts', import.meta.url).href);
          worker.onmessage = (ev: MessageEvent) => {
            const msg = ev.data as { type: string } & Partial<WorkerDone> & { done?: number; total?: number; message?: string };
            if (msg.type === 'progress') {
              job.state.progress[doc.id] = { done: msg.done ?? 0, total: msg.total ?? config.sessions };
              this.emit(job);
            } else if (msg.type === 'done') {
              worker.terminate();
              const results = msg.results ?? [];
              resolveRun({
                strategyId: doc.id,
                doc,
                summary: msg.summary!,
                results,
                series: results.slice(0, config.seriesFor ?? 0).map((r) => r.series ?? []),
                elapsedMs: msg.elapsedMs ?? 0,
              });
            } else if (msg.type === 'error') {
              worker.terminate();
              reject(new Error(`${doc.id}: ${msg.message}`));
            }
          };
          worker.onerror = (ev: ErrorEvent) => {
            worker.terminate();
            reject(new Error(`${doc.id}: ${ev.message}`));
          };
          worker.postMessage({ doc, config });
        }),
    );

    Promise.all(runs)
      .then((saved) => {
        const runId = this.store.saveRun(config, saved, name);
        job.state.status = 'done';
        job.state.runId = runId;
        job.state.finishedAt = new Date().toISOString();
        for (const s of saved) job.state.progress[s.strategyId] = { done: config.sessions, total: config.sessions };
        this.emit(job);
      })
      .catch((err: unknown) => {
        job.state.status = 'error';
        job.state.error = err instanceof Error ? err.message : String(err);
        job.state.finishedAt = new Date().toISOString();
        this.emit(job);
      })
      .finally(() => {
        // Forget finished jobs after a while so the map doesn't grow forever.
        setTimeout(() => this.jobs.delete(id), 30 * 60 * 1000);
      });

    return job.state;
  }
}
