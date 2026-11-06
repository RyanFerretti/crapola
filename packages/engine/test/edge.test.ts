import { describe, expect, test } from 'bun:test';
import type { BetRequest } from '../src/player.ts';
import { runSession } from '../src/session.ts';
import type { DecisionContext, Strategy } from '../src/strategy/types.ts';

/**
 * Monte Carlo house edges per resolved bet. Tolerances are a few standard errors
 * at the given roll counts; a real bug shows up as a miss by whole percentage points.
 */
function edgeOf(req: BetRequest, rolls: number, when: (ctx: DecisionContext) => boolean = () => true, seed = 7): number {
  let staked = 0;
  let net = 0;
  const strat: Strategy = {
    id: 'edge',
    name: 'edge',
    createSession: () => ({
      decide(ctx) {
        for (const e of ctx.events) {
          if (e.kind === 'betWon') {
            net += e.payout;
            staked += e.bet.amount;
          } else if (e.kind === 'betLost') {
            net -= e.bet.amount;
            staked += e.bet.amount;
          }
        }
        if (!when(ctx)) return;
        const has = ctx.player.bets.some((b) => b.type === req.type && (req.number === undefined || b.number === req.number));
        if (!has) ctx.api.bet(req);
      },
    }),
  };
  runSession(strat, { bankroll: 1e9, maxRolls: rolls, seed, rules: { maxBet: 1e9 } });
  return -net / staked;
}

const N = 3_000_000;
let seed = 100;
const close = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected)).toBeLessThan(tol);
const edge = (req: BetRequest, when?: (ctx: DecisionContext) => boolean) => edgeOf(req, N, when, seed++);
const comeOut = (c: DecisionContext) => c.table.point === null;

describe('house edge sanity (per resolved bet)', () => {
  test('pass line ~1.41%', () => close(edge({ type: 'pass', amount: 10 }, comeOut), 0.0141, 0.004));
  test("don't pass ~1.36%", () => close(edge({ type: 'dontPass', amount: 10 }, comeOut), 0.0136, 0.004));
  test('place 6 ~1.52%', () => close(edge({ type: 'place', number: 6, amount: 30 }), 0.0152, 0.004));
  test('place 5 ~4.0%', () => close(edge({ type: 'place', number: 5, amount: 10 }), 0.04, 0.005));
  test('place 4 ~6.67%', () => close(edge({ type: 'place', number: 4, amount: 10 }), 0.0667, 0.006));
  test('buy 4 ($20, vig on win) ~1.67%', () => close(edge({ type: 'buy', number: 4, amount: 20 }), 0.0167, 0.006));
  test('lay 4 ($40, vig on win) ~1.67%', () => close(edge({ type: 'lay', number: 4, amount: 40 }), 0.0167, 0.005));
  test('field 2x/3x ~2.78%', () => close(edge({ type: 'field', amount: 10 }), 0.0278, 0.004));
  test('hard 8 ~9.09%', () => close(edge({ type: 'hardway', number: 8, amount: 10 }), 0.0909, 0.012));
  test('hard 4 ~11.1%', () => close(edge({ type: 'hardway', number: 4, amount: 10 }), 0.111, 0.012));
  test('any seven ~16.7%', () => close(edge({ type: 'anySeven', amount: 10 }), 0.1667, 0.006));
  test('any craps ~11.1%', () => close(edge({ type: 'anyCraps', amount: 10 }), 0.111, 0.008));
  test('yo ~11.1%', () => close(edge({ type: 'eleven', amount: 10 }), 0.111, 0.012));
});
