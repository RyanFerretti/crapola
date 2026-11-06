import {
  type Bet,
  type BetType,
  type OddsBase,
  MIN_BET_TYPES,
  NUMBERED_TYPES,
  ONE_ROLL_TYPES,
  computeVig,
  describeBet,
  isContract,
  isRemovable,
  maxOdds,
} from './bets.ts';
import { type TableRules, isBoxNumber } from './rules.ts';
import type { TableState } from './table.ts';

export interface BetRequest {
  type: BetType;
  amount: number;
  number?: number;
  on?: OddsBase;
  hop?: [number, number];
  working?: boolean;
  tag?: string;
}

export type PlaceResult = { ok: true; bet: Bet; added: number } | { ok: false; reason: string };

export interface PlayerLogger {
  placed(bet: Bet, added: number): void;
  removed(bet: Bet, reason: string): void;
  rejected(req: BetRequest, reason: string): void;
}

export class Player {
  bankroll: number;
  readonly startBankroll: number;
  bets: Bet[] = [];
  totalWagered = 0;
  totalVig = 0;
  peakEquity: number;
  troughEquity: number;
  maxDrawdown = 0;
  private nextId = 1;

  constructor(bankroll: number, private readonly log?: PlayerLogger) {
    this.bankroll = bankroll;
    this.startBankroll = bankroll;
    this.peakEquity = bankroll;
    this.troughEquity = bankroll;
  }

  /** Money in the rack plus money on the table. */
  get onTable(): number {
    let s = 0;
    for (const b of this.bets) s += b.amount;
    return s;
  }
  get equity(): number {
    return this.bankroll + this.onTable;
  }
  get profit(): number {
    return this.equity - this.startBankroll;
  }

  trackEquity(): void {
    const e = this.equity;
    if (e > this.peakEquity) this.peakEquity = e;
    if (e < this.troughEquity) this.troughEquity = e;
    const dd = this.peakEquity - e;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;
  }

  find(pred: (b: Bet) => boolean): Bet | undefined {
    return this.bets.find(pred);
  }

  /** Place a bet. Same-slot bets (e.g. a second Place 6) merge into the existing bet. */
  place(req: BetRequest, table: TableState, rules: TableRules): PlaceResult {
    const amount = Math.floor(req.amount);
    const fail = (reason: string): PlaceResult => {
      this.log?.rejected(req, reason);
      return { ok: false, reason };
    };
    if (!(amount >= 1)) return fail('amount must be at least $1');
    if (amount > rules.maxBet) return fail(`amount exceeds table max $${rules.maxBet}`);
    const pointOn = table.point !== null;

    let number = req.number;
    let on = req.on;
    let existing: Bet | undefined;
    let isPut = false;
    let vigUpFront = 0;

    switch (req.type) {
      case 'pass': {
        if (pointOn) {
          if (!rules.allowPutBets) return fail('pass line bet after the point is a put bet; not allowed');
          isPut = true;
          number = table.point!;
          existing = this.bets.find((b) => b.type === 'pass' && b.number === number);
          if (existing) return fail('cannot add to a pass line bet after the point');
        } else {
          existing = this.bets.find((b) => b.type === 'pass' && b.number == null);
        }
        break;
      }
      case 'dontPass': {
        if (pointOn) return fail("don't pass cannot be made after the point is established");
        existing = this.bets.find((b) => b.type === 'dontPass' && b.number == null);
        break;
      }
      case 'come':
      case 'dontCome': {
        if (!pointOn) return fail(`${req.type} bets can only be made when the point is on`);
        existing = this.bets.find((b) => b.type === req.type && b.number == null);
        break;
      }
      case 'odds': {
        if (!on) return fail('odds require "on" (pass, come, dontPass, dontCome)');
        const base = this.findOddsBase(on, number);
        if (!base.ok) return fail(base.reason);
        number = base.bet.number!;
        existing = this.bets.find((b) => b.type === 'odds' && b.on === on && b.number === number);
        const cap = maxOdds(base.bet.amount, number, on, rules);
        const current = existing?.amount ?? 0;
        if (current + amount > cap) return fail(`odds of $${current + amount} exceed max $${cap} on ${number}`);
        break;
      }
      case 'place':
      case 'buy':
      case 'lay':
      case 'hardway': {
        if (!isBoxNumber(number)) return fail(`${req.type} needs a box number (4,5,6,8,9,10)`);
        if (req.type === 'hardway' && (number === 5 || number === 9)) return fail('hardways exist only on 4, 6, 8, 10');
        if (req.type === 'place' && this.bets.some((b) => (b.type === 'buy' || b.type === 'lay') && b.number === number)) {
          return fail(`already have a buy/lay on ${number}`);
        }
        existing = this.bets.find((b) => b.type === req.type && b.number === number);
        if (req.type === 'buy' && rules.buyVig === 'up-front') vigUpFront = computeVig(amount, rules);
        if (req.type === 'lay' && rules.layVig === 'up-front') {
          const [a, b] = number === 4 || number === 10 ? [1, 2] : number === 5 || number === 9 ? [2, 3] : [5, 6];
          vigUpFront = computeVig(Math.floor((amount * a) / b), rules);
        }
        break;
      }
      case 'hop': {
        const h = req.hop;
        if (!h || h[0] < 1 || h[0] > 6 || h[1] < 1 || h[1] > 6) return fail('hop needs two dice faces');
        const sorted: [number, number] = h[0] <= h[1] ? [h[0], h[1]] : [h[1], h[0]];
        req = { ...req, hop: sorted };
        existing = this.bets.find((b) => b.type === 'hop' && b.hop![0] === sorted[0] && b.hop![1] === sorted[1]);
        break;
      }
      default: {
        existing = this.bets.find((b) => b.type === req.type);
      }
    }

    if (rules.enforceMinimums && MIN_BET_TYPES.has(req.type)) {
      const total = (existing?.amount ?? 0) + amount;
      if (total < rules.minBet) return fail(`$${total} is below the table minimum $${rules.minBet}`);
    }
    const cost = amount + vigUpFront;
    if (cost > this.bankroll) return fail(`insufficient bankroll ($${this.bankroll}) for $${cost}`);

    this.bankroll -= cost;
    this.totalWagered += amount;
    this.totalVig += vigUpFront;

    if (existing) {
      existing.amount += amount;
      if (vigUpFront) existing.vigPaid = (existing.vigPaid ?? 0) + vigUpFront;
      if (req.working !== undefined) existing.workingOverride = req.working;
      this.log?.placed(existing, amount);
      return { ok: true, bet: existing, added: amount };
    }
    const bet: Bet = {
      id: this.nextId++,
      type: req.type,
      amount,
      placedRoll: table.rollNumber,
    };
    if (number !== undefined && (NUMBERED_TYPES.has(req.type) || req.type === 'odds' || isPut)) bet.number = number;
    if (on) bet.on = on;
    if (req.hop) bet.hop = req.hop;
    if (req.working !== undefined) bet.workingOverride = req.working;
    if (isPut) bet.isPut = true;
    if (vigUpFront) bet.vigPaid = vigUpFront;
    if (req.tag) bet.tag = req.tag;
    this.bets.push(bet);
    this.log?.placed(bet, amount);
    return { ok: true, bet, added: amount };
  }

  private findOddsBase(on: OddsBase, number?: number): { ok: true; bet: Bet } | { ok: false; reason: string } {
    const candidates = this.bets.filter((b) => b.type === on && b.number != null && (number === undefined || b.number === number));
    if (candidates.length === 0) return { ok: false, reason: `no ${on} bet with a point${number ? ` on ${number}` : ''} to put odds on` };
    if (candidates.length > 1) return { ok: false, reason: `multiple ${on} bets; specify a number` };
    return { ok: true, bet: candidates[0]! };
  }

  /** Take a bet down. Contract bets cannot be removed. */
  remove(bet: Bet, reason = 'taken down'): { ok: true; returned: number } | { ok: false; reason: string } {
    if (!isRemovable(bet)) return { ok: false, reason: `${describeBet(bet)} is a contract bet` };
    const idx = this.bets.indexOf(bet);
    if (idx < 0) return { ok: false, reason: 'bet not on table' };
    this.bets.splice(idx, 1);
    this.bankroll += bet.amount;
    // Commission paid up front comes back when the bet is taken down.
    if (bet.vigPaid) {
      this.bankroll += bet.vigPaid;
      this.totalVig -= bet.vigPaid;
    }
    // Odds riding on a removed don't bet come down with it.
    if (bet.type === 'dontPass' || bet.type === 'dontCome') {
      for (const o of this.bets.filter((b) => b.type === 'odds' && b.on === bet.type && b.number === bet.number)) {
        this.remove(o, 'base bet removed');
      }
    }
    this.log?.removed(bet, reason);
    return { ok: true, returned: bet.amount };
  }

  /** Remove a bet the house resolved (no money movement here). */
  drop(bet: Bet): void {
    const idx = this.bets.indexOf(bet);
    if (idx >= 0) this.bets.splice(idx, 1);
  }

  /** Change a bet's amount (press or regress). Returns the delta applied. */
  adjust(bet: Bet, newAmount: number, table: TableState, rules: TableRules): { ok: true; delta: number } | { ok: false; reason: string } {
    const target = Math.floor(newAmount);
    if (target <= 0) {
      const r = this.remove(bet, 'regressed to zero');
      return r.ok ? { ok: true, delta: -bet.amount } : r;
    }
    const delta = target - bet.amount;
    if (delta === 0) return { ok: true, delta: 0 };
    if (isContract(bet)) return { ok: false, reason: `${describeBet(bet)} is a contract bet; use odds instead` };
    if ((bet.type === 'dontPass' || bet.type === 'dontCome') && bet.number != null && delta > 0) {
      return { ok: false, reason: `cannot increase a don't bet after the point` };
    }
    if (bet.type === 'odds') {
      const base = this.findOddsBase(bet.on!, bet.number);
      if (!base.ok) return base;
      const cap = maxOdds(base.bet.amount, bet.number!, bet.on!, rules);
      if (target > cap) return { ok: false, reason: `odds of $${target} exceed max $${cap}` };
    }
    if (target > rules.maxBet) return { ok: false, reason: `amount exceeds table max $${rules.maxBet}` };
    if (rules.enforceMinimums && MIN_BET_TYPES.has(bet.type) && target < rules.minBet) {
      return { ok: false, reason: `$${target} is below the table minimum $${rules.minBet}` };
    }
    let vig = 0;
    if (delta > 0 && bet.type === 'buy' && rules.buyVig === 'up-front') vig = computeVig(delta, rules);
    if (delta > 0 && bet.type === 'lay' && rules.layVig === 'up-front') {
      const n = bet.number!;
      const [a, b] = n === 4 || n === 10 ? [1, 2] : n === 5 || n === 9 ? [2, 3] : [5, 6];
      vig = computeVig(Math.floor((delta * a) / b), rules);
    }
    if (delta + vig > this.bankroll) return { ok: false, reason: `insufficient bankroll ($${this.bankroll}) to press by $${delta + vig}` };
    this.bankroll -= delta + vig;
    if (delta > 0) this.totalWagered += delta;
    if (vig) {
      this.totalVig += vig;
      bet.vigPaid = (bet.vigPaid ?? 0) + vig;
    }
    bet.amount = target;
    if (delta > 0) this.log?.placed(bet, delta);
    else this.log?.removed({ ...bet, amount: -delta }, 'regressed');
    return { ok: true, delta };
  }

  setWorking(bet: Bet, working: boolean | undefined): boolean {
    if (isContract(bet) || ONE_ROLL_TYPES.has(bet.type)) return false;
    bet.workingOverride = working;
    return true;
  }

  /** Return every remaining stake to the bankroll (end of session). */
  cashOut(): number {
    let total = 0;
    for (const b of this.bets) {
      total += b.amount;
      if (b.vigPaid) {
        total += b.vigPaid;
        this.totalVig -= b.vigPaid;
      }
    }
    this.bankroll += total;
    this.bets = [];
    return total;
  }
}
