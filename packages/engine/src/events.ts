import type { Bet } from './bets.ts';
import type { Roll } from './rng.ts';
import type { TableEvent } from './table.ts';

export type BetEvent =
  | { kind: 'betWon'; bet: Bet; payout: number; returned: number }
  | { kind: 'betLost'; bet: Bet }
  | { kind: 'betPushed'; bet: Bet }
  | { kind: 'betMoved'; bet: Bet; to: number }
  | { kind: 'betReturned'; bet: Bet; reason: string };

export type GameEvent =
  | { kind: 'sessionStart' }
  | { kind: 'newShooter'; shooterIndex: number }
  | { kind: 'roll'; roll: Roll }
  | TableEvent
  | BetEvent;

export type EventKind = GameEvent['kind'];

export const EVENT_KINDS: readonly EventKind[] = [
  'sessionStart', 'newShooter', 'roll', 'pointEstablished', 'pointMade', 'sevenOut', 'natural', 'craps',
  'betWon', 'betLost', 'betPushed', 'betMoved', 'betReturned',
];
