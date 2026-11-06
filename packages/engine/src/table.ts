import type { Roll } from './rng.ts';

export interface TableState {
  point: number | null;
  /** 1-based index of the current shooter. */
  shooterIndex: number;
  /** Shooters who have sevened out. */
  shootersCompleted: number;
  rollNumber: number;
  rollsThisShooter: number;
  /** Rolls since the current point was established (0 when the point is off). */
  rollsSincePoint: number;
  lastRoll: Roll | null;
  /** Rolls of each total by the current shooter, indexed by total (2..12). */
  hitCounts: number[];
  /** Rolls of each total since the current point was established. */
  hitCountsSincePoint: number[];
  pointsMadeThisShooter: number;
  pointsMade: number;
  sevenOuts: number;
  /** Consecutive come-out rolls that were naturals or craps for the current shooter. */
  comeOutStreak: number;
}

export type TableEvent =
  | { kind: 'pointEstablished'; point: number }
  | { kind: 'pointMade'; point: number }
  | { kind: 'sevenOut'; point: number }
  | { kind: 'natural'; total: number }
  | { kind: 'craps'; total: number };

export function createTableState(): TableState {
  return {
    point: null,
    shooterIndex: 1,
    shootersCompleted: 0,
    rollNumber: 0,
    rollsThisShooter: 0,
    rollsSincePoint: 0,
    lastRoll: null,
    hitCounts: new Array(13).fill(0),
    hitCountsSincePoint: new Array(13).fill(0),
    pointsMadeThisShooter: 0,
    pointsMade: 0,
    sevenOuts: 0,
    comeOutStreak: 0,
  };
}

/** Advance the table by one roll. Returns the table-level events and whether the shooter changed. */
export function applyRoll(s: TableState, roll: Roll): { events: TableEvent[]; shooterChanged: boolean } {
  const t = roll.total;
  const events: TableEvent[] = [];
  let shooterChanged = false;
  s.rollNumber++;
  s.rollsThisShooter++;
  s.lastRoll = roll;
  s.hitCounts[t]!++;

  if (s.point === null) {
    if (t === 7 || t === 11) {
      events.push({ kind: 'natural', total: t });
      s.comeOutStreak++;
    } else if (t === 2 || t === 3 || t === 12) {
      events.push({ kind: 'craps', total: t });
      s.comeOutStreak++;
    } else {
      s.point = t;
      s.rollsSincePoint = 0;
      s.hitCountsSincePoint.fill(0);
      s.comeOutStreak = 0;
      events.push({ kind: 'pointEstablished', point: t });
    }
  } else {
    s.rollsSincePoint++;
    s.hitCountsSincePoint[t]!++;
    if (t === s.point) {
      events.push({ kind: 'pointMade', point: s.point });
      s.point = null;
      s.rollsSincePoint = 0;
      s.pointsMadeThisShooter++;
      s.pointsMade++;
    } else if (t === 7) {
      events.push({ kind: 'sevenOut', point: s.point });
      s.point = null;
      s.rollsSincePoint = 0;
      s.sevenOuts++;
      s.shootersCompleted++;
      shooterChanged = true;
    }
  }
  return { events, shooterChanged };
}

/** Reset per-shooter counters when the dice pass. */
export function nextShooter(s: TableState): void {
  s.shooterIndex++;
  s.rollsThisShooter = 0;
  s.hitCounts.fill(0);
  s.hitCountsSincePoint.fill(0);
  s.pointsMadeThisShooter = 0;
  s.comeOutStreak = 0;
}
