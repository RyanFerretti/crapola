import {
  type Bet,
  type BetSelector,
  type BetType,
  type OddsBase,
  BET_TYPES,
  GROUP_NUMBERS,
  NUMBERED_TYPES,
  betIncrement,
  describeBet,
  isContract,
  maxOdds,
  roundToIncrement,
} from '../bets.ts';
import { EVENT_KINDS, type GameEvent } from '../events.ts';
import type { BetRequest } from '../player.ts';
import { type OddsMultiples, type TableRules, isBoxNumber } from '../rules.ts';
import { type Ast, ExprError, type Scope, type Value, collectNames, evalBool, evalNumber, evaluate, interpolate, parseExpr, truthy } from './expr/index.ts';
import { type Action, type Rule, type SelectorInput, type StrategyDoc, StrategyDocSchema } from './schema.ts';
import type { DecisionContext, Strategy, StrategySession } from './types.ts';

// ---------------------------------------------------------------------------
// Names available to expressions
// ---------------------------------------------------------------------------

export const BUILTIN_IDS: Record<string, string> = {
  unit: 'base betting unit',
  bankroll: 'chips in the rack',
  startBankroll: 'starting bankroll',
  equity: 'bankroll plus money on the table',
  profit: 'equity minus starting bankroll',
  shooterProfit: 'equity change since this shooter picked up the dice',
  pointProfit: 'equity change since the current point was established',
  onTable: 'total money on the table',
  peakEquity: 'highest equity so far',
  drawdown: 'peak equity minus current equity',
  point: 'current point (0 when off)',
  pointOn: 'true when a point is established',
  pointOff: 'true on the come-out',
  comeOut: 'alias of pointOff',
  lastRoll: 'total of the last roll (0 before the first roll)',
  lastHard: 'true when the last roll was a pair',
  die1: 'first die of the last roll',
  die2: 'second die of the last roll',
  rollNumber: 'rolls so far this session',
  rollsThisShooter: 'rolls by the current shooter',
  rollsSincePoint: 'rolls since the point was established',
  shooter: 'current shooter number (1-based)',
  shootersDone: 'shooters who have sevened out',
  pointsMadeThisShooter: 'points made by the current shooter',
  pointsMade: 'points made this session',
  sevenOuts: 'seven-outs this session',
  comeOutStreak: 'consecutive naturals/craps on the come-out for this shooter',
  rollWon: 'total winnings paid on the last roll',
  rollLost: 'total stakes lost on the last roll',
  bet: 'the bet that triggered a betWon/betLost rule (type, number, amount, payout, on)',
  vars: 'strategy variables',
  minBet: 'table minimum',
  maxBet: 'table maximum',
};

export const BUILTIN_FNS: Record<string, string> = {
  hasBet: "hasBet(type[, number]) - true if such a bet is on the table, e.g. hasBet('place', 6)",
  betCount: 'betCount([type[, number]]) - how many matching bets are up',
  betAmount: 'betAmount(type[, number]) - amount of the matching bet (0 if none)',
  totalOn: "totalOn(type|group) - total staked on a type or group ('inside', 'across', 'all')",
  hits: 'hits(n) - times the current shooter has rolled n',
  hitsSincePoint: 'hitsSincePoint(n) - times n rolled since the point was set',
  rolled: 'rolled(n1, n2, ...) - true if the last roll was one of these totals',
  won: "won(type[, number]) - true if such a bet won on the last roll",
  lost: "lost(type[, number]) - true if such a bet lost on the last roll",
  maxOdds: "maxOdds(on[, number]) - maximum odds allowed on that flat bet, e.g. maxOdds('pass')",
  min: 'min(a, b, ...)',
  max: 'max(a, b, ...)',
  floor: 'floor(x)',
  ceil: 'ceil(x)',
  round: 'round(x)',
  abs: 'abs(x)',
  roundUp: 'roundUp(x, increment) - round x up to a multiple of increment',
  roundDown: 'roundDown(x, increment) - round x down to a multiple of increment',
};

const PSEUDO_TRIGGERS = new Set(['always', 'comeOut', 'pointOn']);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  path: string;
  message: string;
}

export class StrategyValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Invalid strategy:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  }
}

interface ParsedTrigger {
  kind: string;
  type?: BetType;
  number?: number;
}

function parseTrigger(s: string): ParsedTrigger {
  const [kind, type, num] = s.split(':');
  const out: ParsedTrigger = { kind: kind! };
  if (type) out.type = type as BetType;
  if (num !== undefined) out.number = Number(num);
  return out;
}

export function parseSelector(input: SelectorInput): BetSelector | 'self' {
  if (typeof input === 'string') {
    const s = input.trim();
    if (s === 'self' || s === 'this') return 'self';
    if (['all', 'inside', 'outside', 'across', 'props', 'removable', 'contracts', 'box'].includes(s)) return { group: s as BetSelector['group'] };
    const parts = s.split(':');
    const type = parts[0] as BetType;
    const sel: BetSelector = { type };
    if (type === 'odds') {
      if (parts[1]) sel.on = parts[1] as OddsBase;
      if (parts[2]) sel.number = Number(parts[2]);
    } else if (parts[1]) {
      if (['inside', 'outside', 'across'].includes(parts[1])) sel.numbers = GROUP_NUMBERS[parts[1] as 'inside'];
      else sel.number = Number(parts[1]);
    }
    return sel;
  }
  const sel: BetSelector = {};
  if (input.type !== undefined) sel.type = input.type as BetType | BetType[];
  if (input.number !== undefined) sel.number = input.number;
  if (input.numbers !== undefined) sel.numbers = typeof input.numbers === 'string' ? GROUP_NUMBERS[input.numbers] : input.numbers;
  if (input.on !== undefined) sel.on = input.on;
  if (input.group !== undefined) sel.group = input.group;
  if (input.tag !== undefined) sel.tag = input.tag;
  return sel;
}

function checkExpr(src: string | number | boolean | undefined, path: string, known: Set<string>, issues: ValidationIssue[]): void {
  if (typeof src !== 'string') return;
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch (e) {
    issues.push({ path, message: e instanceof ExprError ? e.message : String(e) });
    return;
  }
  const { ids, fns } = collectNames(ast);
  for (const id of ids) {
    if (!(id in BUILTIN_IDS) && !known.has(id)) issues.push({ path, message: `unknown identifier "${id}" (declare it under "variables")` });
  }
  for (const fn of fns) {
    if (!(fn in BUILTIN_FNS)) issues.push({ path, message: `unknown function "${fn}"` });
  }
}

function checkSelector(sel: SelectorInput, path: string, issues: ValidationIssue[]): void {
  const parsed = parseSelector(sel);
  if (parsed === 'self') return;
  const types = parsed.type === undefined ? [] : Array.isArray(parsed.type) ? parsed.type : [parsed.type];
  for (const t of types) if (!BET_TYPES.includes(t)) issues.push({ path, message: `unknown bet type "${t}"` });
  if (parsed.number !== undefined && Number.isNaN(parsed.number)) issues.push({ path, message: 'bad number in selector' });
}

export function validateStrategyDoc(input: unknown): { ok: true; doc: StrategyDoc; warnings: string[] } | { ok: false; issues: ValidationIssue[] } {
  const parsed = StrategyDocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    };
  }
  const doc = parsed.data;
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];
  const known = new Set(Object.keys(doc.variables ?? {}));
  // Variables assigned by "set"/"increment" count as declared even if missing from "variables".
  doc.rules.forEach((r) => r.do.forEach((a) => {
    if (a.action === 'set' || a.action === 'increment') {
      if (!known.has(a.var)) {
        warnings.push(`variable "${a.var}" is assigned but not declared under "variables"; it starts undefined (0)`);
        known.add(a.var);
      }
    }
  }));

  doc.rules.forEach((rule, ri) => {
    const rp = `rules[${ri}]${rule.id ? `(${rule.id})` : ''}`;
    const triggers = rule.on === undefined ? [] : Array.isArray(rule.on) ? rule.on : [rule.on];
    for (const t of triggers) {
      const p = parseTrigger(t);
      if (!PSEUDO_TRIGGERS.has(p.kind) && !(EVENT_KINDS as readonly string[]).includes(p.kind)) {
        issues.push({ path: `${rp}.on`, message: `unknown trigger "${t}"` });
      }
      if (p.type && !BET_TYPES.includes(p.type)) issues.push({ path: `${rp}.on`, message: `unknown bet type in trigger "${t}"` });
    }
    checkExpr(rule.when, `${rp}.when`, known, issues);
    rule.do.forEach((a, ai) => {
      const ap = `${rp}.do[${ai}](${a.action})`;
      switch (a.action) {
        case 'bet': {
          checkExpr(a.amount, `${ap}.amount`, known, issues);
          checkExpr(a.multiple, `${ap}.multiple`, known, issues);
          checkExpr(a.maxAmount, `${ap}.maxAmount`, known, issues);
          const needsNumber = NUMBERED_TYPES.has(a.type as BetType);
          if (needsNumber && a.number === undefined && a.numbers === undefined) issues.push({ path: ap, message: `${a.type} needs "number" or "numbers"` });
          if (a.number !== undefined && !isBoxNumber(a.number) && a.type !== 'hop') issues.push({ path: ap, message: `number must be 4, 5, 6, 8, 9 or 10` });
          if (a.type === 'hardway' && (a.number === 5 || a.number === 9)) issues.push({ path: ap, message: 'hardways exist only on 4, 6, 8, 10' });
          if (a.type === 'odds') {
            if (!a.on) issues.push({ path: ap, message: 'odds need "on": pass | come | dontPass | dontCome' });
            if (a.amount === undefined && a.multiple === undefined && !a.max) issues.push({ path: ap, message: 'odds need "amount", "multiple" or "max": true' });
          } else if (a.amount === undefined) issues.push({ path: ap, message: 'missing "amount"' });
          if (a.type === 'hop' && !a.hop) issues.push({ path: ap, message: 'hop needs "hop": [d1, d2]' });
          break;
        }
        case 'press':
          checkSelector(a.target, `${ap}.target`, issues);
          if (a.by !== undefined && !['winnings', 'half', 'full'].includes(String(a.by))) checkExpr(a.by, `${ap}.by`, known, issues);
          checkExpr(a.max, `${ap}.max`, known, issues);
          break;
        case 'regress':
          checkSelector(a.target, `${ap}.target`, issues);
          checkExpr(a.to, `${ap}.to`, known, issues);
          break;
        case 'takeDown':
        case 'setWorking':
          checkSelector(a.target, `${ap}.target`, issues);
          break;
        case 'set':
          checkExpr(a.value, `${ap}.value`, known, issues);
          break;
        case 'increment':
          checkExpr(a.by, `${ap}.by`, known, issues);
          break;
        case 'sitOut':
          if (a.until === 'rolls' && !a.rolls) issues.push({ path: ap, message: 'sitOut until "rolls" needs "rolls"' });
          break;
        case 'log':
          for (const m of a.message.matchAll(/\{([^{}]+)\}/g)) checkExpr(m[1]!.trim(), `${ap}.message`, known, issues);
          break;
      }
    });
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, doc, warnings };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

interface CompiledRule {
  index: number;
  id: string;
  triggers: ParsedTrigger[];
  always: boolean;
  when?: Ast;
  actions: Action[];
  once?: Rule['once'];
}

interface Current {
  bet: Bet | null;
  payout: number;
}

type SitOut = { until: 'nextShooter' | 'pointEstablished' | 'pointOff' } | { until: 'rolls'; rolls: number };

class DslSession implements StrategySession {
  private vars: Record<string, Value>;
  private firedSession = new Set<number>();
  private firedShooter = new Map<number, number>();
  private firedPoint = new Map<number, string>();
  private pointCycle = 0;
  private sitOut: SitOut | null = null;

  constructor(
    private readonly doc: StrategyDoc,
    private readonly rules: CompiledRule[],
  ) {
    this.vars = { ...(doc.variables ?? {}) };
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = { ...this.vars };
    if (this.sitOut) out._sitOut = this.sitOut.until === 'rolls' ? `${this.sitOut.rolls} rolls` : this.sitOut.until;
    return out;
  }

  decide(ctx: DecisionContext): void {
    const events = ctx.events;
    if (events.some((e) => e.kind === 'pointEstablished')) this.pointCycle++;

    if (this.sitOut) {
      const so = this.sitOut;
      let done = false;
      if (so.until === 'nextShooter') done = events.some((e) => e.kind === 'newShooter');
      else if (so.until === 'pointEstablished') done = events.some((e) => e.kind === 'pointEstablished');
      else if (so.until === 'pointOff') done = ctx.table.point === null;
      else if (so.until === 'rolls') {
        if (events.some((e) => e.kind === 'roll')) so.rolls--;
        done = so.rolls <= 0;
      }
      if (!done) return;
      this.sitOut = null;
    }

    const current: Current = { bet: null, payout: 0 };
    const scope = this.makeScope(ctx, current);

    for (const rule of this.rules) {
      const instances = this.instances(rule, ctx);
      if (instances.length === 0) continue;
      let firedThisDecision = false;
      for (const inst of instances) {
        if (rule.once === 'roll' && firedThisDecision) break;
        if (!this.onceAllows(rule, ctx)) break;
        current.bet = inst.bet;
        current.payout = inst.payout;
        if (rule.when && !truthy(evaluate(rule.when, scope))) continue;
        this.markFired(rule, ctx);
        firedThisDecision = true;
        for (const action of rule.actions) {
          this.execute(action, ctx, scope, current);
          if (this.sitOut) break;
        }
        if (this.sitOut) break;
      }
      if (this.sitOut) break;
    }
  }

  private instances(rule: CompiledRule, ctx: DecisionContext): Current[] {
    if (rule.always) return [{ bet: null, payout: 0 }];
    const out: Current[] = [];
    let plain = false;
    for (const trig of rule.triggers) {
      if (trig.kind === 'comeOut') {
        if (ctx.table.point === null) plain = true;
        continue;
      }
      if (trig.kind === 'pointOn') {
        if (ctx.table.point !== null) plain = true;
        continue;
      }
      for (const ev of ctx.events) {
        if (ev.kind !== trig.kind) continue;
        if ('bet' in ev) {
          const b = ev.bet;
          if (trig.type !== undefined && b.type !== trig.type) continue;
          if (trig.number !== undefined && b.number !== trig.number) continue;
          out.push({ bet: b, payout: ev.kind === 'betWon' ? ev.payout : 0 });
        } else plain = true;
      }
    }
    if (plain) out.push({ bet: null, payout: 0 });
    return out;
  }

  private pointKey(ctx: DecisionContext): string {
    return ctx.table.point === null ? `off${this.pointCycle}` : `on${this.pointCycle}`;
  }

  private onceAllows(rule: CompiledRule, ctx: DecisionContext): boolean {
    switch (rule.once) {
      case 'session':
        return !this.firedSession.has(rule.index);
      case 'shooter':
        return this.firedShooter.get(rule.index) !== ctx.table.shooterIndex;
      case 'point':
        return this.firedPoint.get(rule.index) !== this.pointKey(ctx);
      default:
        return true;
    }
  }

  private markFired(rule: CompiledRule, ctx: DecisionContext): void {
    switch (rule.once) {
      case 'session':
        this.firedSession.add(rule.index);
        break;
      case 'shooter':
        this.firedShooter.set(rule.index, ctx.table.shooterIndex);
        break;
      case 'point':
        this.firedPoint.set(rule.index, this.pointKey(ctx));
        break;
    }
  }

  // -- scope ---------------------------------------------------------------

  private makeScope(ctx: DecisionContext, current: Current): Scope {
    const { table, player, rules } = ctx;
    const vars = this.vars;
    const rollWon = ctx.events.reduce((s, e) => (e.kind === 'betWon' ? s + e.payout : s), 0);
    const rollLost = ctx.events.reduce((s, e) => (e.kind === 'betLost' ? s + e.bet.amount : s), 0);
    const betView = (b: Bet, payout: number): Record<string, Value> => ({
      type: b.type,
      number: b.number ?? 0,
      amount: b.amount,
      payout,
      on: b.on ?? null,
      tag: b.tag ?? null,
    });
    const matches = (type: Value, number: Value) => (b: Bet) =>
      (type === undefined || type === 'all' || b.type === type) && (number === undefined || b.number === Number(number));

    return {
      unit: ctx.unit,
      get(name: string): Value {
        switch (name) {
          case 'unit':
            return ctx.unit;
          case 'bankroll':
            return player.bankroll;
          case 'startBankroll':
            return player.startBankroll;
          case 'equity':
            return player.equity;
          case 'profit':
            return player.profit;
          case 'shooterProfit':
            return player.equity - ctx.shooterStartEquity;
          case 'pointProfit':
            return player.equity - ctx.pointStartEquity;
          case 'onTable':
            return player.onTable;
          case 'peakEquity':
            return player.peakEquity;
          case 'drawdown':
            return player.peakEquity - player.equity;
          case 'point':
            return table.point ?? 0;
          case 'pointOn':
            return table.point !== null;
          case 'pointOff':
          case 'comeOut':
            return table.point === null;
          case 'lastRoll':
            return table.lastRoll?.total ?? 0;
          case 'lastHard':
            return table.lastRoll?.hard ?? false;
          case 'die1':
            return table.lastRoll?.d1 ?? 0;
          case 'die2':
            return table.lastRoll?.d2 ?? 0;
          case 'rollNumber':
            return table.rollNumber;
          case 'rollsThisShooter':
            return table.rollsThisShooter;
          case 'rollsSincePoint':
            return table.rollsSincePoint;
          case 'shooter':
            return table.shooterIndex;
          case 'shootersDone':
            return table.shootersCompleted;
          case 'pointsMadeThisShooter':
            return table.pointsMadeThisShooter;
          case 'pointsMade':
            return table.pointsMade;
          case 'sevenOuts':
            return table.sevenOuts;
          case 'comeOutStreak':
            return table.comeOutStreak;
          case 'rollWon':
            return rollWon;
          case 'rollLost':
            return rollLost;
          case 'bet':
            return current.bet ? betView(current.bet, current.payout) : null;
          case 'vars':
            return vars as Record<string, unknown>;
          case 'minBet':
            return rules.minBet;
          case 'maxBet':
            return rules.maxBet;
          default:
            if (name in vars) return vars[name];
            throw new Error(`unknown identifier "${name}"`);
        }
      },
      call(name: string, args: Value[]): Value {
        const nums = () => args.map((a) => Number(a ?? 0));
        switch (name) {
          case 'hasBet':
            return player.bets.some(matches(args[0], args[1]));
          case 'betCount':
            return player.bets.filter(matches(args[0], args[1])).length;
          case 'betAmount':
            return player.bets.filter(matches(args[0], args[1])).reduce((s, b) => s + b.amount, 0);
          case 'totalOn': {
            const g = String(args[0]);
            if (g === 'all') return player.onTable;
            if (g in GROUP_NUMBERS) {
              const ns = GROUP_NUMBERS[g as 'inside'] as readonly number[];
              return player.bets.filter((b) => (b.type === 'place' || b.type === 'buy') && ns.includes(b.number ?? 0)).reduce((s, b) => s + b.amount, 0);
            }
            return player.bets.filter((b) => b.type === g).reduce((s, b) => s + b.amount, 0);
          }
          case 'hits':
            return table.hitCounts[Number(args[0])] ?? 0;
          case 'hitsSincePoint':
            return table.hitCountsSincePoint[Number(args[0])] ?? 0;
          case 'rolled':
            return table.lastRoll ? nums().includes(table.lastRoll.total) : false;
          case 'won':
            return ctx.events.some((e) => e.kind === 'betWon' && matches(args[0], args[1])(e.bet));
          case 'lost':
            return ctx.events.some((e) => e.kind === 'betLost' && matches(args[0], args[1])(e.bet));
          case 'maxOdds': {
            const on = String(args[0]) as OddsBase;
            const number = args[1] !== undefined ? Number(args[1]) : on === 'pass' || on === 'dontPass' ? (table.point ?? 0) : undefined;
            const flat = player.bets.find((b) => b.type === on && b.number != null && (number === undefined || b.number === number));
            return flat ? maxOdds(flat.amount, flat.number!, on, rules) : 0;
          }
          case 'min':
            return Math.min(...nums());
          case 'max':
            return Math.max(...nums());
          case 'floor':
            return Math.floor(Number(args[0] ?? 0));
          case 'ceil':
            return Math.ceil(Number(args[0] ?? 0));
          case 'round':
            return Math.round(Number(args[0] ?? 0));
          case 'abs':
            return Math.abs(Number(args[0] ?? 0));
          case 'roundUp':
            return roundToIncrement(Number(args[0] ?? 0), Number(args[1] ?? 1), 'up');
          case 'roundDown':
            return roundToIncrement(Number(args[0] ?? 0), Number(args[1] ?? 1), 'down');
          default:
            throw new Error(`unknown function "${name}"`);
        }
      },
    };
  }

  // -- actions -------------------------------------------------------------

  private rounding(mode: 'up' | 'down' | 'nearest' | 'none' | undefined, fallback: 'up' | 'down' | 'nearest' | 'none' = 'up') {
    return mode ?? this.doc.rounding ?? fallback;
  }

  private select(input: SelectorInput, ctx: DecisionContext, current: Current): Bet[] {
    const sel = parseSelector(input);
    if (sel === 'self') {
      if (!current.bet) return [];
      const live = ctx.player.bets.find((b) => b.id === current.bet!.id);
      return live ? [live] : [];
    }
    return ctx.api.select(sel);
  }

  private execute(action: Action, ctx: DecisionContext, scope: Scope, current: Current): void {
    switch (action.action) {
      case 'bet':
        return this.executeBet(action, ctx, scope);
      case 'press': {
        const targets = this.select(action.target, ctx, current);
        const max = action.max !== undefined ? evalNumber(action.max, scope) : Infinity;
        for (const t of targets) {
          if (isContract(t)) continue;
          let delta: number;
          const by = action.by ?? 'winnings';
          if (by === 'winnings' || by === 'half') {
            let payout = 0;
            if (current.bet && current.bet.id === t.id) payout = current.payout;
            else {
              const ev = ctx.events.find((e) => e.kind === 'betWon' && e.bet.id === t.id);
              payout = ev && ev.kind === 'betWon' ? ev.payout : 0;
            }
            delta = by === 'half' ? payout / 2 : payout;
          } else if (by === 'full') delta = t.amount;
          else delta = evalNumber(by, scope);
          if (delta <= 0) continue;
          const inc = betIncrement(t.type, t.number, t.on);
          let target = roundToIncrement(t.amount + delta, inc, this.rounding(action.rounding, 'down'));
          target = Math.min(target, max);
          if (target <= t.amount) continue;
          ctx.api.adjust(t, target);
        }
        return;
      }
      case 'regress': {
        const to = evalNumber(action.to, scope);
        for (const t of this.select(action.target, ctx, current)) {
          if (isContract(t)) continue;
          const inc = betIncrement(t.type, t.number, t.on);
          const target = to <= 0 ? 0 : roundToIncrement(to, inc, this.rounding(action.rounding));
          if (target === t.amount) continue;
          ctx.api.adjust(t, target);
        }
        return;
      }
      case 'takeDown': {
        for (const t of this.select(action.target, ctx, current)) ctx.api.remove(t, 'taken down');
        return;
      }
      case 'setWorking': {
        const sel = parseSelector(action.target);
        const working = action.working === null ? undefined : action.working;
        if (sel === 'self') {
          for (const t of this.select(action.target, ctx, current)) ctx.api.setWorking({ type: t.type, number: t.number, on: t.on }, working);
        } else ctx.api.setWorking(sel, working);
        return;
      }
      case 'set': {
        this.vars[action.var] = typeof action.value === 'boolean' ? action.value : typeof action.value === 'number' ? action.value : evaluate(parseExpr(action.value), scope);
        return;
      }
      case 'increment': {
        const by = action.by === undefined ? 1 : evalNumber(action.by, scope);
        this.vars[action.var] = Number(this.vars[action.var] ?? 0) + by;
        return;
      }
      case 'sitOut':
        this.sitOut = action.until === 'rolls' ? { until: 'rolls', rolls: action.rolls ?? 1 } : { until: action.until };
        ctx.api.log(`sitting out until ${action.until}${action.until === 'rolls' ? ` (${action.rolls})` : ''}`);
        return;
      case 'walkAway':
        ctx.api.walkAway(action.mode);
        return;
      case 'log':
        ctx.api.log(interpolate(action.message, scope));
        return;
    }
  }

  private executeBet(action: Extract<Action, { action: 'bet' }>, ctx: DecisionContext, scope: Scope): void {
    const type = action.type as BetType;
    const mode = action.mode ?? 'ensure';
    const { player, table, rules } = ctx;
    const rounding = this.rounding(action.rounding);

    if (type === 'odds') {
      const on = action.on!;
      const flats = player.bets.filter(
        (b) =>
          b.type === on &&
          b.number != null &&
          (action.number === undefined || b.number === action.number) &&
          (action.numbers === undefined || this.numbersOf(action.numbers, table.point).includes(b.number)),
      );
      for (const flat of flats) {
        const existing = player.bets.find((b) => b.type === 'odds' && b.on === on && b.number === flat.number);
        if (existing && mode === 'ensure') continue;
        const cap = maxOdds(flat.amount, flat.number!, on, rules);
        let amount: number;
        if (action.max) amount = cap;
        else if (action.multiple !== undefined) amount = flat.amount * evalNumber(action.multiple, scope);
        else amount = evalNumber(action.amount!, scope);
        const inc = betIncrement('odds', flat.number, on);
        const room = mode === 'set' || !existing ? cap : cap - existing.amount;
        amount = Math.min(amount, room);
        amount = roundToIncrement(amount, inc, action.rounding ?? 'down');
        if (amount <= 0) continue;
        if (mode === 'set' && existing) {
          if (existing.amount !== amount) ctx.api.adjust(existing, amount);
          continue;
        }
        ctx.api.bet({ type: 'odds', on, number: flat.number, amount, working: action.working, tag: action.tag });
      }
      return;
    }

    const numbers: Array<number | undefined> = NUMBERED_TYPES.has(type)
      ? this.numbersOf(action.numbers ?? [action.number!], table.point, action.skipPoint)
      : [undefined];

    for (const number of numbers) {
      const existing = this.findSlot(type, number, action.hop, ctx);
      if (existing && mode === 'ensure') continue;
      const raw = evalNumber(action.amount!, scope);
      const inc = betIncrement(type, number, action.on);
      let amount = roundToIncrement(raw, inc, rounding);
      if (action.maxAmount !== undefined) {
        const cap = evalNumber(action.maxAmount, scope);
        if (mode === 'add' && existing) amount = Math.min(amount, cap - existing.amount);
        else amount = Math.min(amount, cap);
      }
      if (amount <= 0) continue;
      if (mode === 'set' && existing) {
        if (existing.amount !== amount) ctx.api.adjust(existing, amount);
        if (action.working !== undefined) ctx.api.setWorking({ type, number }, action.working);
        continue;
      }
      const req: BetRequest = { type, amount, working: action.working, tag: action.tag };
      if (number !== undefined) req.number = number;
      if (action.hop) req.hop = action.hop;
      ctx.api.bet(req);
    }
  }

  private numbersOf(input: number[] | 'inside' | 'outside' | 'across', point: number | null, skipPoint?: boolean): number[] {
    const ns = typeof input === 'string' ? [...GROUP_NUMBERS[input]] : [...input];
    return skipPoint && point !== null ? ns.filter((n) => n !== point) : ns;
  }

  private findSlot(type: BetType, number: number | undefined, hop: [number, number] | undefined, ctx: DecisionContext): Bet | undefined {
    const { player, table } = ctx;
    switch (type) {
      case 'pass':
        return table.point === null ? player.bets.find((b) => b.type === 'pass' && b.number == null) : player.bets.find((b) => b.type === 'pass' && b.number === table.point);
      case 'dontPass':
        return table.point === null ? player.bets.find((b) => b.type === 'dontPass' && b.number == null) : player.bets.find((b) => b.type === 'dontPass' && b.number === table.point);
      case 'come':
      case 'dontCome':
        return player.bets.find((b) => b.type === type && b.number == null);
      case 'hop': {
        const [a, b] = hop![0] <= hop![1] ? hop! : [hop![1], hop![0]];
        return player.bets.find((x) => x.type === 'hop' && x.hop![0] === a && x.hop![1] === b);
      }
      default:
        return NUMBERED_TYPES.has(type) ? player.bets.find((b) => b.type === type && b.number === number) : player.bets.find((b) => b.type === type);
    }
  }
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export function compileStrategy(doc: StrategyDoc): Strategy {
  const rules: CompiledRule[] = doc.rules
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.enabled !== false)
    .map(({ r, index }) => {
      const triggers = (r.on === undefined ? [] : Array.isArray(r.on) ? r.on : [r.on]).map(parseTrigger);
      return {
        index,
        id: r.id ?? `rule-${index + 1}`,
        triggers,
        always: triggers.length === 0 || triggers.some((t) => t.kind === 'always'),
        when: r.when ? parseExpr(r.when) : undefined,
        actions: r.do,
        once: r.once,
      };
    });

  const table: Partial<TableRules> | undefined = doc.table
    ? (Object.fromEntries(Object.entries(doc.table).filter(([, v]) => v !== undefined)) as Partial<TableRules>)
    : undefined;
  if (table && typeof table.oddsPolicy === 'object') table.oddsPolicy = table.oddsPolicy as OddsMultiples;

  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    unit: doc.unit,
    table,
    exit: doc.exit,
    createSession: () => new DslSession(doc, rules),
  };
}

/** Validate and compile a JSON strategy document. Throws StrategyValidationError. */
export function loadStrategy(input: unknown): { strategy: Strategy; doc: StrategyDoc; warnings: string[] } {
  const v = validateStrategyDoc(input);
  if (!v.ok) throw new StrategyValidationError(v.issues);
  return { strategy: compileStrategy(v.doc), doc: v.doc, warnings: v.warnings };
}

export { describeBet };
export type { GameEvent };
export { evalBool };
