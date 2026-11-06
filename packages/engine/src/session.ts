import { type Bet, type BetSelector, type Resolution, describeBet, isRemovable, matchBet, resolveBet } from './bets.ts';
import type { GameEvent } from './events.ts';
import { type BetRequest, type PlaceResult, Player } from './player.ts';
import { type DiceSource, FixedDice, type Roll, SeededDice } from './rng.ts';
import { type TableRules, mergeRules } from './rules.ts';
import type { ActionApi, DecisionContext, ExitConfig, ExitMode, Strategy, StrategySession } from './strategy/types.ts';
import { type TableState, applyRoll, createTableState, nextShooter } from './table.ts';

export interface RunConfig extends ExitConfig {
  bankroll: number;
  unit?: number;
  rules?: Partial<TableRules>;
  seed?: number;
  /** Scripted dice; falls back to the seeded source when exhausted. */
  fixedRolls?: Array<[number, number]>;
  /** Keep a per-roll narrative (for single-session play). */
  recordLog?: boolean;
  /** Keep the equity after every roll (for charts). */
  recordSeries?: boolean;
}

export type EndReason = 'maxShooters' | 'maxRolls' | 'stopLoss' | 'winGoal' | 'busted' | 'walkedAway' | 'diceExhausted';

export interface RollRecord {
  rollNumber: number;
  shooterIndex: number;
  d1: number;
  d2: number;
  total: number;
  pointBefore: number | null;
  pointAfter: number | null;
  outcomes: string[];
  actions: string[];
  logs: string[];
  /** Actions ("> ...") and logs ("# ...") in the order they happened. */
  trace: string[];
  bankroll: number;
  equity: number;
  betsAfter: string[];
  state?: Record<string, unknown>;
}

export interface SessionResult {
  strategyId: string;
  seed: number;
  startBankroll: number;
  endBankroll: number;
  profit: number;
  rolls: number;
  shooters: number;
  shootersStarted: number;
  peakEquity: number;
  troughEquity: number;
  maxDrawdown: number;
  totalWagered: number;
  totalVig: number;
  pointsMade: number;
  endReason: EndReason;
  /** Stakes returned at the end because bets were still up. */
  unresolvedReturned: number;
  rejectedBets: number;
  series?: number[];
  log?: RollRecord[];
}

const SAFETY_MAX_ROLLS = 1_000_000;

export class Session {
  readonly rules: TableRules;
  readonly unit: number;
  readonly exit: ExitConfig;
  readonly seed: number;
  readonly player: Player;
  readonly table: TableState;
  private readonly dice: DiceSource;
  private readonly strat: StrategySession;
  private readonly log: RollRecord[] = [];
  private readonly series: number[] = [];
  private current: RollRecord | null = null;
  private windingDown: EndReason | null = null;
  private exitMode: ExitMode;
  private shooterStartEquity: number;
  private pointStartEquity: number;
  private rejected = 0;
  private unresolvedReturned = 0;
  private placedThisDecision = 0;
  private rejectedForFundsThisDecision = 0;
  private stalledSinceShooter: number | null = null;

  constructor(
    readonly strategy: Strategy,
    readonly config: RunConfig,
  ) {
    this.rules = mergeRules(strategy.table, config.rules);
    this.unit = config.unit ?? strategy.unit ?? this.rules.minBet;
    this.exit = {
      stopLoss: config.stopLoss ?? strategy.exit?.stopLoss,
      winGoal: config.winGoal ?? strategy.exit?.winGoal,
      maxShooters: config.maxShooters ?? strategy.exit?.maxShooters,
      maxRolls: config.maxRolls ?? strategy.exit?.maxRolls,
      exitMode: config.exitMode ?? strategy.exit?.exitMode ?? 'takeDown',
    };
    this.exitMode = this.exit.exitMode!;
    this.seed = config.seed ?? 1;
    const seeded = new SeededDice(this.seed);
    this.dice = config.fixedRolls?.length ? new FixedDice(config.fixedRolls, config.maxShooters || config.maxRolls ? seeded : undefined) : seeded;
    this.player = new Player(config.bankroll, {
      placed: (bet, added) => {
        this.placedThisDecision++;
        this.note(`bet ${describeBet(bet)}${added !== bet.amount ? ` (+$${added})` : ''}`);
      },
      removed: (bet, reason) => this.note(`down ${describeBet(bet)} (${reason})`),
      rejected: (req, reason) => {
        this.rejected++;
        if (reason.startsWith('insufficient bankroll')) this.rejectedForFundsThisDecision++;
        this.note(`rejected ${req.type}${req.number ? ` ${req.number}` : ''} $${req.amount}: ${reason}`);
      },
    });
    this.table = createTableState();
    this.strat = strategy.createSession();
    this.shooterStartEquity = this.player.equity;
    this.pointStartEquity = this.player.equity;
  }

  private note(msg: string): void {
    if (!this.current) return;
    this.current.actions.push(msg);
    this.current.trace.push(`> ${msg}`);
  }

  private makeApi(): ActionApi {
    const player = this.player;
    const table = this.table;
    const rules = this.rules;
    const self = this;
    return {
      bet: (req: BetRequest): PlaceResult => player.place(req, table, rules),
      select: (sel: BetSelector) => player.bets.filter((b) => matchBet(b, sel)),
      remove: (sel, reason) => {
        const targets = 'id' in sel && 'amount' in sel ? [sel as Bet] : player.bets.filter((b) => matchBet(b, sel as BetSelector) && isRemovable(b));
        let n = 0;
        for (const b of targets) if (player.remove(b, reason).ok) n++;
        return n;
      },
      adjust: (bet, amount) => {
        const r = player.adjust(bet, amount, table, rules);
        if (!r.ok) {
          self.rejected++;
          if (r.reason.startsWith('insufficient bankroll')) self.rejectedForFundsThisDecision++;
          self.note(`rejected ${amount > bet.amount ? 'press' : 'regress'} of ${describeBet(bet)} to $${amount}: ${r.reason}`);
        }
        return r;
      },
      setWorking: (sel, working) => {
        let n = 0;
        for (const b of player.bets.filter((b) => matchBet(b, sel))) if (player.setWorking(b, working)) n++;
        if (n) self.note(`${working === undefined ? 'default' : working ? 'on' : 'off'}: ${n} bet(s)`);
        return n;
      },
      walkAway: (mode) => {
        if (!self.windingDown) {
          self.windingDown = 'walkedAway';
          if (mode) self.exitMode = mode;
          self.note('walk away');
        }
      },
      log: (message) => {
        if (!self.current) return;
        self.current.logs.push(message);
        self.current.trace.push(`# ${message}`);
      },
    };
  }

  private decide(events: GameEvent[]): void {
    const ctx: DecisionContext = {
      events,
      table: this.table,
      player: this.player,
      rules: this.rules,
      unit: this.unit,
      shooterStartEquity: this.shooterStartEquity,
      pointStartEquity: this.pointStartEquity,
      api: this.makeApi(),
    };
    this.placedThisDecision = 0;
    this.rejectedForFundsThisDecision = 0;
    this.strat.decide(ctx);
    // A strategy that keeps asking for bets it cannot fund, with nothing on the table, is broke
    // even if the rack still holds a few chips. Give it one full shooter to recover.
    if (this.player.bets.length === 0 && this.rejectedForFundsThisDecision > 0 && this.placedThisDecision === 0) {
      if (this.stalledSinceShooter === null) this.stalledSinceShooter = this.table.shooterIndex;
      else if (this.table.shooterIndex > this.stalledSinceShooter && !this.windingDown) this.windingDown = 'busted';
    } else if (this.player.bets.length > 0 || this.placedThisDecision > 0) this.stalledSinceShooter = null;
  }

  private startRecord(roll: Roll | null, pointBefore: number | null): void {
    if (!this.config.recordLog) return;
    this.current = {
      rollNumber: this.table.rollNumber,
      shooterIndex: this.table.shooterIndex,
      d1: roll?.d1 ?? 0,
      d2: roll?.d2 ?? 0,
      total: roll?.total ?? 0,
      pointBefore,
      pointAfter: this.table.point,
      outcomes: [],
      actions: [],
      logs: [],
      trace: [],
      bankroll: 0,
      equity: 0,
      betsAfter: [],
    };
  }

  private finishRecord(): void {
    if (!this.current) return;
    this.current.pointAfter = this.table.point;
    this.current.bankroll = this.player.bankroll;
    this.current.equity = this.player.equity;
    this.current.betsAfter = this.player.bets.map(describeBet);
    if (this.strat.snapshot) this.current.state = this.strat.snapshot();
    this.log.push(this.current);
    this.current = null;
  }

  /** Check exit conditions; returns true when the session should stop placing new bets. */
  private checkExit(): void {
    if (this.windingDown) return;
    const profit = this.player.profit;
    if (this.exit.winGoal !== undefined && profit >= this.exit.winGoal) this.windingDown = 'winGoal';
    else if (this.exit.stopLoss !== undefined && profit <= -this.exit.stopLoss) this.windingDown = 'stopLoss';
    else if (this.exit.maxShooters !== undefined && this.table.shootersCompleted >= this.exit.maxShooters) this.windingDown = 'maxShooters';
    else if (this.exit.maxRolls !== undefined && this.table.rollNumber >= this.exit.maxRolls) this.windingDown = 'maxRolls';
    else if (this.player.bets.length === 0 && this.player.bankroll < Math.min(this.rules.minBet, this.unit)) this.windingDown = 'busted';
  }

  private applyResolutions(roll: Roll, pointBefore: number | null): GameEvent[] {
    const isComeOut = pointBefore === null;
    const events: GameEvent[] = [];
    const resolutions: Resolution[] = this.player.bets.map((b) => resolveBet(b, roll, pointBefore, isComeOut, this.rules));
    for (const r of resolutions) {
      const bet = r.bet;
      switch (r.result) {
        case 'win':
          this.player.bankroll += r.payout + r.returned;
          this.player.totalVig += r.vig;
          if (r.removed) this.player.drop(bet);
          events.push({ kind: 'betWon', bet: { ...bet }, payout: r.payout, returned: r.returned });
          this.current?.outcomes.push(`${describeBet(bet)} won $${r.payout}${r.removed ? '' : ' (stays up)'}`);
          break;
        case 'lose':
          this.player.drop(bet);
          events.push({ kind: 'betLost', bet: { ...bet } });
          this.current?.outcomes.push(`${describeBet(bet)} lost`);
          break;
        case 'push':
          this.player.bankroll += r.returned;
          this.player.drop(bet);
          events.push({ kind: 'betPushed', bet: { ...bet } });
          this.current?.outcomes.push(`${describeBet(bet)} pushed`);
          break;
        case 'move':
          bet.number = r.movedTo;
          events.push({ kind: 'betMoved', bet: { ...bet }, to: r.movedTo! });
          this.current?.outcomes.push(`${describeBet(bet)}`);
          break;
      }
    }
    // Odds whose flat bet is gone (e.g. come odds that were off on the come-out) are returned.
    for (const o of [...this.player.bets]) {
      if (o.type !== 'odds') continue;
      const base = this.player.bets.find((b) => b.type === o.on && b.number === o.number);
      if (!base) {
        this.player.drop(o);
        this.player.bankroll += o.amount;
        events.push({ kind: 'betReturned', bet: { ...o }, reason: 'flat bet resolved while odds were off' });
        this.current?.outcomes.push(`${describeBet(o)} returned`);
      }
    }
    return events;
  }

  run(): SessionResult {
    this.startRecord(null, null);
    this.decide([{ kind: 'sessionStart' }, { kind: 'newShooter', shooterIndex: 1 }]);
    this.player.trackEquity();
    this.checkExit();
    this.finishRecord();
    if (this.config.recordSeries) this.series.push(this.player.equity);

    let safety = 0;
    const cap = Math.max(SAFETY_MAX_ROLLS, this.exit.maxRolls ?? 0);
    while (safety++ < cap) {
      if (this.windingDown) {
        // A roll cap is a hard stop; everything else lets contract bets ride out.
        if (this.windingDown === 'maxRolls') break;
        if (this.exitMode === 'takeDown') this.takeDownRemovable();
        if (this.player.bets.length === 0) break;
      }
      let roll: Roll;
      try {
        roll = this.dice.roll();
      } catch {
        this.windingDown = this.windingDown ?? 'diceExhausted';
        break;
      }
      const pointBefore = this.table.point;
      this.startRecord(roll, pointBefore);
      const betEvents = this.applyResolutions(roll, pointBefore);
      const { events: tableEvents, shooterChanged } = applyRoll(this.table, roll);
      if (this.current) {
        this.current.rollNumber = this.table.rollNumber;
        this.current.shooterIndex = this.table.shooterIndex;
      }
      const events: GameEvent[] = [{ kind: 'roll', roll }, ...tableEvents, ...betEvents];
      if (tableEvents.some((e) => e.kind === 'pointEstablished')) this.pointStartEquity = this.player.equity;
      if (shooterChanged) {
        nextShooter(this.table);
        this.shooterStartEquity = this.player.equity;
        this.pointStartEquity = this.player.equity;
        events.push({ kind: 'newShooter', shooterIndex: this.table.shooterIndex });
      }
      this.player.trackEquity();
      this.checkExit();
      if (!this.windingDown) {
        this.decide(events);
        this.player.trackEquity();
        this.checkExit();
      }
      if (this.config.recordSeries) this.series.push(this.player.equity);
      this.finishRecord();
    }

    this.unresolvedReturned = this.player.cashOut();
    const endReason: EndReason = this.windingDown ?? 'maxRolls';
    const p = this.player;
    return {
      strategyId: this.strategy.id,
      seed: this.seed,
      startBankroll: p.startBankroll,
      endBankroll: p.bankroll,
      profit: p.bankroll - p.startBankroll,
      rolls: this.table.rollNumber,
      shooters: this.table.shootersCompleted,
      shootersStarted: this.table.shooterIndex,
      peakEquity: p.peakEquity,
      troughEquity: p.troughEquity,
      maxDrawdown: p.maxDrawdown,
      totalWagered: p.totalWagered,
      totalVig: p.totalVig,
      pointsMade: this.table.pointsMade,
      endReason,
      unresolvedReturned: this.unresolvedReturned,
      rejectedBets: this.rejected,
      series: this.config.recordSeries ? this.series : undefined,
      log: this.config.recordLog ? this.log : undefined,
    };
  }

  private takeDownRemovable(): void {
    for (const b of [...this.player.bets]) {
      if (isRemovable(b)) this.player.remove(b, 'leaving');
    }
  }
}

export function runSession(strategy: Strategy, config: RunConfig): SessionResult {
  return new Session(strategy, config).run();
}
