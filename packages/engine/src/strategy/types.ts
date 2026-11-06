import type { Bet, BetSelector } from '../bets.ts';
import type { GameEvent } from '../events.ts';
import type { BetRequest, PlaceResult, Player } from '../player.ts';
import type { TableRules } from '../rules.ts';
import type { TableState } from '../table.ts';

export type ExitMode = 'takeDown' | 'rideOut';

export interface ExitConfig {
  /** Stop once equity has fallen this far below the starting bankroll. */
  stopLoss?: number;
  /** Stop once equity is this far above the starting bankroll. */
  winGoal?: number;
  maxShooters?: number;
  maxRolls?: number;
  /** What to do with bets still on the table when stopping. */
  exitMode?: ExitMode;
}

/** What a strategy can do at a decision point. Every call takes effect immediately. */
export interface ActionApi {
  bet(req: BetRequest): PlaceResult;
  select(sel: BetSelector): Bet[];
  /** Take matching removable bets down. Returns how many came down. */
  remove(sel: BetSelector | Bet, reason?: string): number;
  /** Set a bet to a new amount (press/regress). */
  adjust(bet: Bet, amount: number): { ok: true; delta: number } | { ok: false; reason: string };
  /** Call matching bets on/off; `undefined` restores table defaults. */
  setWorking(sel: BetSelector, working: boolean | undefined): number;
  walkAway(mode?: ExitMode): void;
  log(message: string): void;
}

export interface DecisionContext {
  events: readonly GameEvent[];
  table: Readonly<TableState>;
  player: Readonly<Player>;
  rules: TableRules;
  unit: number;
  shooterStartEquity: number;
  pointStartEquity: number;
  api: ActionApi;
}

/** A live strategy instance bound to one session. */
export interface StrategySession {
  decide(ctx: DecisionContext): void;
  /** Internal state for logs and debugging. */
  snapshot?(): Record<string, unknown>;
}

export interface Strategy {
  id: string;
  name: string;
  description?: string;
  unit?: number;
  table?: Partial<TableRules>;
  exit?: ExitConfig;
  createSession(): StrategySession;
}
