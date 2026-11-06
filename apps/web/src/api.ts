import type { SessionResult, StrategySummary, ValidationIssue } from '@crapola/engine';

export interface StrategyListItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source: { type: string; url?: string; title?: string; channel?: string; importedAt?: string; notes?: string } | null;
  unit: number | null;
  bankroll: number | null;
  ruleCount: number;
  valid: boolean;
  issues: ValidationIssue[];
  warnings: string[];
}

/** Loosely typed editable strategy document (the server validates). */
export type EAction = { action: string; [k: string]: unknown };
export interface ERule {
  id?: string;
  description?: string;
  on?: string | string[];
  when?: string;
  once?: string;
  enabled?: boolean;
  do: EAction[];
}
export interface EDoc {
  version: 1;
  id: string;
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  source?: Record<string, unknown>;
  unit?: number;
  bankroll?: number;
  table?: Record<string, unknown>;
  exit?: Record<string, unknown>;
  variables?: Record<string, number | string | boolean>;
  rounding?: string;
  rules: ERule[];
  notes?: string;
}

export interface Reference {
  identifiers: Record<string, string>;
  functions: Record<string, string>;
  betTypes: string[];
  eventKinds: string[];
  triggers: string[];
  schema: unknown;
  docs: string;
}

export interface JobState {
  id: string;
  status: 'running' | 'done' | 'error';
  strategyIds: string[];
  progress: Record<string, { done: number; total: number }>;
  runId?: number;
  error?: string;
}

export interface RunListItem {
  id: number;
  createdAt: string;
  name: string | null;
  sessions: number;
  bankroll: number;
  strategyIds: string[];
  means: Record<string, number>;
}

export interface RunConfig {
  sessions: number;
  bankroll: number;
  unit?: number;
  maxShooters?: number;
  maxRolls?: number;
  stopLoss?: number;
  winGoal?: number;
  seed?: number;
  rules?: { minBet?: number; oddsPolicy?: string };
}

export interface RunStrategy {
  strategyId: string;
  name: string;
  doc: EDoc | null;
  summary: StrategySummary;
  series: number[][];
  profits: number[];
  endReasons: Record<string, number>;
  elapsedMs: number;
}

export interface RunDetail {
  id: number;
  createdAt: string;
  name: string | null;
  config: RunConfig;
  strategies: RunStrategy[];
  headToHead: number[][] | null;
}

export interface PlayRequest {
  strategyId?: string;
  doc?: EDoc;
  bankroll?: number;
  unit?: number;
  dice?: string;
  seed?: number;
  shooters?: number;
  rolls?: number;
  stopLoss?: number;
  winGoal?: number;
  tableMin?: number;
  odds?: string;
}

export interface Transcript {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  segments: Array<{ start: number; text: string }>;
  text: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues?: ValidationIssue[],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: ValidationIssue[] } & T;
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.issues);
  return body;
}

export const api = {
  strategies: () => request<StrategyListItem[]>('/api/strategies'),
  strategy: (id: string) => request<StrategyListItem & { doc: EDoc }>(`/api/strategies/${encodeURIComponent(id)}`),
  createStrategy: (doc: EDoc) => request<{ ok: true; id: string; warnings: string[] }>('/api/strategies', { method: 'POST', body: JSON.stringify(doc) }),
  saveStrategy: (id: string, doc: EDoc) =>
    request<{ ok: true; id: string; warnings: string[] }>(`/api/strategies/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(doc) }),
  deleteStrategy: (id: string) => request<{ ok: true }>(`/api/strategies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  validate: (doc: unknown) => request<{ ok: boolean; issues: ValidationIssue[]; warnings: string[] }>('/api/validate', { method: 'POST', body: JSON.stringify(doc) }),
  reference: () => request<Reference>('/api/reference'),
  play: (req: PlayRequest) => request<SessionResult>('/api/play', { method: 'POST', body: JSON.stringify(req) }),
  startRun: (body: Record<string, unknown>) => request<JobState>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  job: (id: string) => request<JobState>(`/api/jobs/${id}`),
  runs: () => request<RunListItem[]>('/api/runs'),
  run: (id: number | string) => request<RunDetail>(`/api/runs/${id}`),
  deleteRun: (id: number) => request<{ ok: true }>(`/api/runs/${id}`, { method: 'DELETE' }),
  transcript: (url: string) => request<Transcript>(`/api/transcript?url=${encodeURIComponent(url)}`),
};
