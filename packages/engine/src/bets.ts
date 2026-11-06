import type { Roll } from './rng.ts';
import { type BoxNumber, type TableRules, isBoxNumber, oddsMultiples } from './rules.ts';

export type BetType =
  | 'pass'
  | 'dontPass'
  | 'come'
  | 'dontCome'
  | 'odds'
  | 'place'
  | 'buy'
  | 'lay'
  | 'field'
  | 'hardway'
  | 'anySeven'
  | 'anyCraps'
  | 'two'
  | 'three'
  | 'eleven'
  | 'twelve'
  | 'ce'
  | 'horn'
  | 'world'
  | 'hop'
  | 'big6'
  | 'big8';

export const BET_TYPES: readonly BetType[] = [
  'pass', 'dontPass', 'come', 'dontCome', 'odds', 'place', 'buy', 'lay', 'field', 'hardway',
  'anySeven', 'anyCraps', 'two', 'three', 'eleven', 'twelve', 'ce', 'horn', 'world', 'hop', 'big6', 'big8',
];

export type OddsBase = 'pass' | 'come' | 'dontPass' | 'dontCome';

export const ONE_ROLL_TYPES: ReadonlySet<BetType> = new Set([
  'field', 'anySeven', 'anyCraps', 'two', 'three', 'eleven', 'twelve', 'ce', 'horn', 'world', 'hop',
]);
export const PROP_TYPES: ReadonlySet<BetType> = new Set([
  'hardway', 'anySeven', 'anyCraps', 'two', 'three', 'eleven', 'twelve', 'ce', 'horn', 'world', 'hop',
]);
/** Bets that need a box number. */
export const NUMBERED_TYPES: ReadonlySet<BetType> = new Set(['place', 'buy', 'lay', 'hardway']);
/** Bets subject to the table minimum. */
export const MIN_BET_TYPES: ReadonlySet<BetType> = new Set([
  'pass', 'dontPass', 'come', 'dontCome', 'place', 'buy', 'lay', 'field', 'big6', 'big8',
]);

export interface Bet {
  id: number;
  type: BetType;
  amount: number;
  /** Point for pass/come/dontPass/dontCome once set; box number for place/buy/lay/hardway/odds. */
  number?: number;
  /** For odds: which flat bet they ride on. */
  on?: OddsBase;
  /** For hop bets: the two dice faces. */
  hop?: [number, number];
  /** Explicit "on"/"off" call by the player; undefined follows table defaults. */
  workingOverride?: boolean;
  placedRoll: number;
  isPut?: boolean;
  /** Vig already paid up front (buy/lay). */
  vigPaid?: number;
  /** Optional label from the strategy, for logs. */
  tag?: string;
}

export type BetResult = 'win' | 'lose' | 'push' | 'move' | 'none';

export interface Resolution {
  bet: Bet;
  result: BetResult;
  /** Net winnings credited to the bankroll (after vig). */
  payout: number;
  /** Stake returned to the bankroll because the bet came down. */
  returned: number;
  vig: number;
  removed: boolean;
  movedTo?: number;
}

export function roundPayout(amount: number, rules: TableRules): number {
  return rules.payoutRounding === 'floor' ? Math.floor(amount + 1e-9) : amount;
}

export function pay(amount: number, num: number, den: number, rules: TableRules): number {
  return roundPayout((amount * num) / den, rules);
}

export function computeVig(base: number, rules: TableRules): number {
  return Math.max(rules.vigMinimum, Math.floor(base * rules.vigRate + 1e-9));
}

/** True odds as [num, den] paid to a right-side bet on the number. */
export function trueOdds(n: number): [number, number] {
  if (n === 4 || n === 10) return [2, 1];
  if (n === 5 || n === 9) return [3, 2];
  return [6, 5];
}

/** Place bet odds. */
export function placeOdds(n: number): [number, number] {
  if (n === 4 || n === 10) return [9, 5];
  if (n === 5 || n === 9) return [7, 5];
  return [7, 6];
}

/** Lay (wrong-side) odds: what $den of lay wins $num. */
export function layOdds(n: number): [number, number] {
  const [a, b] = trueOdds(n);
  return [b, a];
}

export function isContract(bet: Bet): boolean {
  return (bet.type === 'pass' || bet.type === 'come') && bet.number != null;
}

export function isRemovable(bet: Bet): boolean {
  return !isContract(bet);
}

/** Smallest sensible increment so the payout is whole dollars. */
export function betIncrement(type: BetType, number?: number, on?: OddsBase): number {
  switch (type) {
    case 'place':
      return number === 6 || number === 8 ? 6 : 5;
    case 'buy':
      return number === 5 || number === 9 ? 2 : number === 6 || number === 8 ? 5 : 1;
    case 'lay':
      return number === 4 || number === 10 ? 2 : number === 5 || number === 9 ? 3 : 6;
    case 'odds': {
      const dont = on === 'dontPass' || on === 'dontCome';
      if (number === 5 || number === 9) return dont ? 3 : 2;
      if (number === 6 || number === 8) return dont ? 6 : 5;
      return dont ? 2 : 1;
    }
    case 'horn':
      return 4;
    case 'world':
      return 5;
    case 'ce':
      return 2;
    default:
      return 1;
  }
}

export function roundToIncrement(amount: number, inc: number, mode: 'up' | 'down' | 'nearest' | 'none'): number {
  if (mode === 'none' || inc <= 1) return Math.floor(amount);
  const q = amount / inc;
  const k = mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q);
  return Math.max(0, k * inc);
}

/** Maximum odds allowed on a flat bet of `flat` on `number`. */
export function maxOdds(flat: number, number: number, on: OddsBase, rules: TableRules): number {
  if (!isBoxNumber(number)) return 0;
  const mult = oddsMultiples(rules.oddsPolicy)[number as BoxNumber];
  const maxWin = flat * mult;
  if (on === 'dontPass' || on === 'dontCome') {
    // Don't players may lay enough to win the right-side maximum.
    const [num, den] = trueOdds(number);
    return Math.floor((maxWin * num) / den);
  }
  return maxWin;
}

export function isBetWorking(bet: Bet, isComeOut: boolean, rules: TableRules): boolean {
  if (bet.workingOverride !== undefined) {
    // Contract bets and one-roll bets always work regardless of what the player says.
    if (isContract(bet) || ONE_ROLL_TYPES.has(bet.type)) return true;
    return bet.workingOverride;
  }
  if (!isComeOut) return true;
  switch (bet.type) {
    case 'place':
      return rules.placeWorkingOnComeOut;
    case 'buy':
      return rules.buyWorkingOnComeOut;
    case 'hardway':
      return rules.hardwaysWorkingOnComeOut;
    case 'lay':
      return rules.layWorkingOnComeOut;
    case 'odds':
      if (bet.on === 'come') return rules.comeOddsWorkingOnComeOut;
      if (bet.on === 'dontCome') return rules.dontComeOddsWorkingOnComeOut;
      return true;
    default:
      return true;
  }
}

function none(bet: Bet): Resolution {
  return { bet, result: 'none', payout: 0, returned: 0, vig: 0, removed: false };
}
function lose(bet: Bet): Resolution {
  return { bet, result: 'lose', payout: 0, returned: 0, vig: 0, removed: true };
}
function win(bet: Bet, payout: number, removed: boolean, vig = 0): Resolution {
  return { bet, result: 'win', payout, returned: removed ? bet.amount : 0, vig, removed };
}
function push(bet: Bet): Resolution {
  return { bet, result: 'push', payout: 0, returned: bet.amount, vig: 0, removed: true };
}
function move(bet: Bet, to: number): Resolution {
  return { bet, result: 'move', payout: 0, returned: 0, vig: 0, removed: false, movedTo: to };
}

/**
 * Resolve a single bet against a roll. `point` is the table point BEFORE the roll.
 * `isComeOut` is true when the point was off before the roll.
 */
export function resolveBet(bet: Bet, roll: Roll, point: number | null, isComeOut: boolean, rules: TableRules): Resolution {
  const t = roll.total;
  const working = isBetWorking(bet, isComeOut, rules);
  const pp = rules.propPayouts;

  switch (bet.type) {
    case 'pass':
    case 'come': {
      if (bet.number == null) {
        if (t === 7 || t === 11) return win(bet, pay(bet.amount, 1, 1, rules), true);
        if (t === 2 || t === 3 || t === 12) return lose(bet);
        return move(bet, t);
      }
      if (t === bet.number) return win(bet, pay(bet.amount, 1, 1, rules), true);
      if (t === 7) return lose(bet);
      return none(bet);
    }
    case 'dontPass':
    case 'dontCome': {
      if (bet.number == null) {
        if (t === 7 || t === 11) return lose(bet);
        if (t === rules.dontBar) return none(bet);
        if (t === 2 || t === 3 || t === 12) return win(bet, pay(bet.amount, 1, 1, rules), true);
        return move(bet, t);
      }
      if (t === 7) return win(bet, pay(bet.amount, 1, 1, rules), true);
      if (t === bet.number) return lose(bet);
      return none(bet);
    }
    case 'odds': {
      const n = bet.number;
      if (n == null || !working) return none(bet);
      const dont = bet.on === 'dontPass' || bet.on === 'dontCome';
      if (!dont) {
        if (t === n) {
          const [a, b] = trueOdds(n);
          return win(bet, pay(bet.amount, a, b, rules), true);
        }
        if (t === 7) return lose(bet);
        return none(bet);
      }
      if (t === 7) {
        const [a, b] = layOdds(n);
        return win(bet, pay(bet.amount, a, b, rules), true);
      }
      if (t === n) return lose(bet);
      return none(bet);
    }
    case 'place': {
      if (!working) return none(bet);
      if (t === bet.number) {
        const [a, b] = placeOdds(bet.number!);
        return win(bet, pay(bet.amount, a, b, rules), false);
      }
      if (t === 7) return lose(bet);
      return none(bet);
    }
    case 'buy': {
      if (!working) return none(bet);
      if (t === bet.number) {
        const [a, b] = trueOdds(bet.number!);
        const gross = pay(bet.amount, a, b, rules);
        const vig = rules.buyVig === 'on-win' ? computeVig(bet.amount, rules) : 0;
        return win(bet, gross - vig, false, vig);
      }
      if (t === 7) return lose(bet);
      return none(bet);
    }
    case 'lay': {
      if (!working) return none(bet);
      if (t === 7) {
        const [a, b] = layOdds(bet.number!);
        const gross = pay(bet.amount, a, b, rules);
        const vig = rules.layVig === 'on-win' ? computeVig(gross, rules) : 0;
        return win(bet, gross - vig, false, vig);
      }
      if (t === bet.number) return lose(bet);
      return none(bet);
    }
    case 'field': {
      if (t === 2) return win(bet, pay(bet.amount, rules.fieldPays.two, 1, rules), true);
      if (t === 12) return win(bet, pay(bet.amount, rules.fieldPays.twelve, 1, rules), true);
      if (t === 3 || t === 4 || t === 9 || t === 10 || t === 11) return win(bet, pay(bet.amount, 1, 1, rules), true);
      return lose(bet);
    }
    case 'hardway': {
      if (!working) return none(bet);
      const n = bet.number!;
      if (t === n) {
        if (!roll.hard) return lose(bet);
        const mult = n === 4 ? pp.hard4 : n === 6 ? pp.hard6 : n === 8 ? pp.hard8 : pp.hard10;
        return win(bet, pay(bet.amount, mult, 1, rules), false);
      }
      if (t === 7) return lose(bet);
      return none(bet);
    }
    case 'anySeven':
      return t === 7 ? win(bet, pay(bet.amount, pp.anySeven, 1, rules), true) : lose(bet);
    case 'anyCraps':
      return t === 2 || t === 3 || t === 12 ? win(bet, pay(bet.amount, pp.anyCraps, 1, rules), true) : lose(bet);
    case 'two':
      return t === 2 ? win(bet, pay(bet.amount, pp.two, 1, rules), true) : lose(bet);
    case 'three':
      return t === 3 ? win(bet, pay(bet.amount, pp.three, 1, rules), true) : lose(bet);
    case 'eleven':
      return t === 11 ? win(bet, pay(bet.amount, pp.eleven, 1, rules), true) : lose(bet);
    case 'twelve':
      return t === 12 ? win(bet, pay(bet.amount, pp.twelve, 1, rules), true) : lose(bet);
    case 'ce': {
      // Half on any craps, half on eleven; the losing half is forfeited.
      const half = bet.amount / 2;
      if (t === 2 || t === 3 || t === 12) return win(bet, roundPayout(half * pp.anyCraps - half, rules), true);
      if (t === 11) return win(bet, roundPayout(half * pp.eleven - half, rules), true);
      return lose(bet);
    }
    case 'horn': {
      const q = bet.amount / 4;
      if (t === 2) return win(bet, roundPayout(q * pp.two - 3 * q, rules), true);
      if (t === 12) return win(bet, roundPayout(q * pp.twelve - 3 * q, rules), true);
      if (t === 3) return win(bet, roundPayout(q * pp.three - 3 * q, rules), true);
      if (t === 11) return win(bet, roundPayout(q * pp.eleven - 3 * q, rules), true);
      return lose(bet);
    }
    case 'world': {
      const f = bet.amount / 5;
      if (t === 2) return win(bet, roundPayout(f * pp.two - 4 * f, rules), true);
      if (t === 12) return win(bet, roundPayout(f * pp.twelve - 4 * f, rules), true);
      if (t === 3) return win(bet, roundPayout(f * pp.three - 4 * f, rules), true);
      if (t === 11) return win(bet, roundPayout(f * pp.eleven - 4 * f, rules), true);
      if (t === 7) return push(bet);
      return lose(bet);
    }
    case 'hop': {
      const [a, b] = bet.hop!;
      const match = (roll.d1 === a && roll.d2 === b) || (roll.d1 === b && roll.d2 === a);
      if (!match) return lose(bet);
      return win(bet, pay(bet.amount, a === b ? pp.hopHard : pp.hopEasy, 1, rules), true);
    }
    case 'big6':
    case 'big8': {
      const n = bet.type === 'big6' ? 6 : 8;
      if (t === n) return win(bet, pay(bet.amount, 1, 1, rules), false);
      if (t === 7) return lose(bet);
      return none(bet);
    }
  }
}

export function describeBet(bet: Bet): string {
  switch (bet.type) {
    case 'pass':
      return bet.number ? `${bet.isPut ? 'Put' : 'Pass'} $${bet.amount} (${bet.number})` : `Pass $${bet.amount}`;
    case 'dontPass':
      return bet.number ? `Don't Pass $${bet.amount} (${bet.number})` : `Don't Pass $${bet.amount}`;
    case 'come':
      return bet.number ? `Come $${bet.amount} on ${bet.number}` : `Come $${bet.amount}`;
    case 'dontCome':
      return bet.number ? `Don't Come $${bet.amount} on ${bet.number}` : `Don't Come $${bet.amount}`;
    case 'odds':
      return `${bet.on === 'dontPass' || bet.on === 'dontCome' ? 'Lay odds' : 'Odds'} $${bet.amount} on ${bet.number} (${bet.on})`;
    case 'place':
      return `Place ${bet.number} $${bet.amount}`;
    case 'buy':
      return `Buy ${bet.number} $${bet.amount}`;
    case 'lay':
      return `Lay ${bet.number} $${bet.amount}`;
    case 'hardway':
      return `Hard ${bet.number} $${bet.amount}`;
    case 'hop':
      return `Hop ${bet.hop![0]}-${bet.hop![1]} $${bet.amount}`;
    default:
      return `${bet.type} $${bet.amount}`;
  }
}

/** A selector picks bets on the table. All provided fields must match. */
export interface BetSelector {
  type?: BetType | BetType[];
  number?: number;
  numbers?: number[];
  on?: OddsBase;
  group?: 'all' | 'inside' | 'outside' | 'across' | 'props' | 'removable' | 'contracts' | 'box';
  tag?: string;
}

export const GROUP_NUMBERS: Record<'inside' | 'outside' | 'across', BoxNumber[]> = {
  inside: [5, 6, 8, 9],
  outside: [4, 5, 9, 10],
  across: [4, 5, 6, 8, 9, 10],
};

export function matchBet(bet: Bet, sel: BetSelector): boolean {
  if (sel.type !== undefined) {
    const types = Array.isArray(sel.type) ? sel.type : [sel.type];
    if (!types.includes(bet.type)) return false;
  }
  if (sel.number !== undefined && bet.number !== sel.number) return false;
  if (sel.numbers !== undefined && (bet.number === undefined || !sel.numbers.includes(bet.number))) return false;
  if (sel.on !== undefined && bet.on !== sel.on) return false;
  if (sel.tag !== undefined && bet.tag !== sel.tag) return false;
  if (sel.group !== undefined && sel.group !== 'all') {
    switch (sel.group) {
      case 'props':
        if (!PROP_TYPES.has(bet.type)) return false;
        break;
      case 'removable':
        if (!isRemovable(bet)) return false;
        break;
      case 'contracts':
        if (!isContract(bet)) return false;
        break;
      case 'box':
        if (!NUMBERED_TYPES.has(bet.type) || bet.type === 'hardway') return false;
        break;
      default:
        if (!NUMBERED_TYPES.has(bet.type) || bet.type === 'hardway') return false;
        if (!GROUP_NUMBERS[sel.group].includes(bet.number as BoxNumber)) return false;
    }
  }
  return true;
}
