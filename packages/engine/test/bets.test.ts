import { describe, expect, test } from 'bun:test';
import { type Bet, betIncrement, isBetWorking, maxOdds, resolveBet, roundToIncrement } from '../src/bets.ts';
import { makeRoll } from '../src/rng.ts';
import { DEFAULT_RULES, mergeRules } from '../src/rules.ts';

const R = DEFAULT_RULES;
let id = 1;
const bet = (partial: Partial<Bet> & { type: Bet['type']; amount: number }): Bet => ({ id: id++, placedRoll: 0, ...partial });
const res = (b: Bet, d1: number, d2: number, point: number | null = null) => resolveBet(b, makeRoll(d1, d2), point, point === null, R);

describe('line bets', () => {
  test('pass line come-out', () => {
    expect(res(bet({ type: 'pass', amount: 10 }), 3, 4)).toMatchObject({ result: 'win', payout: 10, returned: 10, removed: true });
    expect(res(bet({ type: 'pass', amount: 10 }), 5, 6)).toMatchObject({ result: 'win', payout: 10 });
    expect(res(bet({ type: 'pass', amount: 10 }), 1, 1)).toMatchObject({ result: 'lose', removed: true });
    expect(res(bet({ type: 'pass', amount: 10 }), 6, 6)).toMatchObject({ result: 'lose' });
    expect(res(bet({ type: 'pass', amount: 10 }), 2, 4)).toMatchObject({ result: 'move', movedTo: 6 });
  });
  test('pass line with point', () => {
    expect(res(bet({ type: 'pass', amount: 10, number: 6 }), 3, 3, 6)).toMatchObject({ result: 'win', payout: 10 });
    expect(res(bet({ type: 'pass', amount: 10, number: 6 }), 3, 4, 6)).toMatchObject({ result: 'lose' });
    expect(res(bet({ type: 'pass', amount: 10, number: 6 }), 4, 4, 6)).toMatchObject({ result: 'none' });
  });
  test("don't pass bars 12", () => {
    expect(res(bet({ type: 'dontPass', amount: 10 }), 1, 1)).toMatchObject({ result: 'win', payout: 10 });
    expect(res(bet({ type: 'dontPass', amount: 10 }), 1, 2)).toMatchObject({ result: 'win' });
    expect(res(bet({ type: 'dontPass', amount: 10 }), 6, 6)).toMatchObject({ result: 'none', removed: false });
    expect(res(bet({ type: 'dontPass', amount: 10 }), 3, 4)).toMatchObject({ result: 'lose' });
    expect(res(bet({ type: 'dontPass', amount: 10, number: 8 }), 3, 4, 8)).toMatchObject({ result: 'win', payout: 10 });
    expect(res(bet({ type: 'dontPass', amount: 10, number: 8 }), 4, 4, 8)).toMatchObject({ result: 'lose' });
  });
});

describe('odds', () => {
  test('pass odds pay true odds', () => {
    expect(res(bet({ type: 'odds', amount: 30, on: 'pass', number: 4 }), 2, 2, 4).payout).toBe(60);
    expect(res(bet({ type: 'odds', amount: 40, on: 'pass', number: 5 }), 2, 3, 5).payout).toBe(60);
    expect(res(bet({ type: 'odds', amount: 50, on: 'pass', number: 6 }), 3, 3, 6).payout).toBe(60);
    expect(res(bet({ type: 'odds', amount: 50, on: 'pass', number: 6 }), 3, 4, 6).result).toBe('lose');
  });
  test('lay odds pay inverse', () => {
    expect(res(bet({ type: 'odds', amount: 60, on: 'dontPass', number: 4 }), 3, 4, 4).payout).toBe(30);
    expect(res(bet({ type: 'odds', amount: 60, on: 'dontPass', number: 9 }), 3, 4, 9).payout).toBe(40);
    expect(res(bet({ type: 'odds', amount: 60, on: 'dontPass', number: 8 }), 3, 4, 8).payout).toBe(50);
    expect(res(bet({ type: 'odds', amount: 60, on: 'dontPass', number: 8 }), 4, 4, 8).result).toBe('lose');
  });
  test('3-4-5x maximums', () => {
    expect(maxOdds(10, 4, 'pass', R)).toBe(30);
    expect(maxOdds(10, 5, 'pass', R)).toBe(40);
    expect(maxOdds(10, 8, 'pass', R)).toBe(50);
    expect(maxOdds(10, 4, 'dontPass', R)).toBe(60);
    expect(maxOdds(10, 9, 'dontPass', R)).toBe(60);
    expect(maxOdds(10, 6, 'dontPass', R)).toBe(60);
    expect(maxOdds(10, 6, 'pass', mergeRules({ oddsPolicy: '10x' }))).toBe(100);
  });
  test('come odds are off on the come-out by default', () => {
    const o = bet({ type: 'odds', amount: 25, on: 'come', number: 6 });
    expect(isBetWorking(o, true, R)).toBe(false);
    expect(isBetWorking(o, false, R)).toBe(true);
    expect(isBetWorking({ ...o, workingOverride: true }, true, R)).toBe(true);
    expect(resolveBet(o, makeRoll(3, 3), null, true, R).result).toBe('none');
  });
});

describe('box bets', () => {
  test('place payouts', () => {
    expect(res(bet({ type: 'place', amount: 12, number: 6 }), 3, 3, 4)).toMatchObject({ result: 'win', payout: 14, removed: false, returned: 0 });
    expect(res(bet({ type: 'place', amount: 12, number: 8 }), 4, 4, 4).payout).toBe(14);
    expect(res(bet({ type: 'place', amount: 10, number: 5 }), 2, 3, 4).payout).toBe(14);
    expect(res(bet({ type: 'place', amount: 10, number: 9 }), 4, 5, 4).payout).toBe(14);
    expect(res(bet({ type: 'place', amount: 10, number: 4 }), 2, 2, 5).payout).toBe(18);
    expect(res(bet({ type: 'place', amount: 10, number: 10 }), 4, 6, 5).payout).toBe(18);
    expect(res(bet({ type: 'place', amount: 10, number: 6 }), 3, 3, 4).payout).toBe(11);
    expect(res(bet({ type: 'place', amount: 12, number: 6 }), 3, 4, 4).result).toBe('lose');
  });
  test('place bets are off on the come-out', () => {
    expect(res(bet({ type: 'place', amount: 12, number: 6 }), 3, 3, null).result).toBe('none');
    expect(res(bet({ type: 'place', amount: 12, number: 6 }), 3, 4, null).result).toBe('none');
    expect(res(bet({ type: 'place', amount: 12, number: 6, workingOverride: true }), 3, 3, null).result).toBe('win');
  });
  test('buy pays true odds minus vig on win', () => {
    expect(res(bet({ type: 'buy', amount: 25, number: 4 }), 2, 2, 6)).toMatchObject({ result: 'win', payout: 49, vig: 1 });
    expect(res(bet({ type: 'buy', amount: 40, number: 10 }), 4, 6, 6)).toMatchObject({ payout: 78, vig: 2 });
    expect(res(bet({ type: 'buy', amount: 20, number: 5 }), 2, 3, 6)).toMatchObject({ payout: 29, vig: 1 });
  });
  test('lay pays inverse odds minus vig on the win', () => {
    expect(res(bet({ type: 'lay', amount: 40, number: 4 }), 3, 4, 6)).toMatchObject({ result: 'win', payout: 19, vig: 1 });
    expect(res(bet({ type: 'lay', amount: 120, number: 6 }), 3, 4, 8)).toMatchObject({ payout: 95, vig: 5 });
    expect(res(bet({ type: 'lay', amount: 120, number: 6 }), 3, 3, 8).result).toBe('lose');
    expect(res(bet({ type: 'lay', amount: 40, number: 4 }), 3, 4, null).result).toBe('win');
  });
});

describe('one-roll and props', () => {
  test('field', () => {
    expect(res(bet({ type: 'field', amount: 10 }), 1, 1).payout).toBe(20);
    expect(res(bet({ type: 'field', amount: 10 }), 6, 6).payout).toBe(30);
    expect(res(bet({ type: 'field', amount: 10 }), 1, 2).payout).toBe(10);
    expect(res(bet({ type: 'field', amount: 10 }), 5, 6).payout).toBe(10);
    expect(res(bet({ type: 'field', amount: 10 }), 3, 4).result).toBe('lose');
    expect(res(bet({ type: 'field', amount: 10 }), 3, 3).result).toBe('lose');
  });
  test('hardways', () => {
    expect(res(bet({ type: 'hardway', amount: 5, number: 8 }), 4, 4, 6)).toMatchObject({ result: 'win', payout: 45, removed: false });
    expect(res(bet({ type: 'hardway', amount: 5, number: 8 }), 3, 5, 6).result).toBe('lose');
    expect(res(bet({ type: 'hardway', amount: 5, number: 4 }), 2, 2, 6).payout).toBe(35);
    expect(res(bet({ type: 'hardway', amount: 5, number: 4 }), 3, 4, 6).result).toBe('lose');
    expect(res(bet({ type: 'hardway', amount: 5, number: 4 }), 2, 2, null).result).toBe('none');
  });
  test('props', () => {
    expect(res(bet({ type: 'anySeven', amount: 5 }), 3, 4).payout).toBe(20);
    expect(res(bet({ type: 'anyCraps', amount: 5 }), 1, 2).payout).toBe(35);
    expect(res(bet({ type: 'two', amount: 1 }), 1, 1).payout).toBe(30);
    expect(res(bet({ type: 'eleven', amount: 2 }), 5, 6).payout).toBe(30);
    expect(res(bet({ type: 'ce', amount: 2 }), 1, 1).payout).toBe(6);
    expect(res(bet({ type: 'ce', amount: 2 }), 5, 6).payout).toBe(14);
    expect(res(bet({ type: 'horn', amount: 4 }), 6, 6).payout).toBe(27);
    expect(res(bet({ type: 'horn', amount: 4 }), 1, 2).payout).toBe(12);
    expect(res(bet({ type: 'world', amount: 5 }), 3, 4).result).toBe('push');
    expect(res(bet({ type: 'world', amount: 5 }), 1, 1).payout).toBe(26);
    expect(res(bet({ type: 'hop', amount: 1, hop: [2, 5] }), 5, 2).payout).toBe(15);
    expect(res(bet({ type: 'hop', amount: 1, hop: [4, 4] }), 4, 4).payout).toBe(30);
    expect(res(bet({ type: 'hop', amount: 1, hop: [4, 4] }), 3, 5).result).toBe('lose');
  });
});

describe('increments', () => {
  test('casino increments', () => {
    expect(betIncrement('place', 6)).toBe(6);
    expect(betIncrement('place', 5)).toBe(5);
    expect(betIncrement('odds', 5, 'pass')).toBe(2);
    expect(betIncrement('odds', 6, 'pass')).toBe(5);
    expect(betIncrement('odds', 6, 'dontPass')).toBe(6);
    expect(roundToIncrement(10, 6, 'up')).toBe(12);
    expect(roundToIncrement(14, 6, 'down')).toBe(12);
    expect(roundToIncrement(10, 6, 'none')).toBe(10);
  });
});
