import { describe, expect, test } from 'bun:test';
import { BET_TYPES } from '../src/bets.ts';
import { parseRolls } from '../src/rng.ts';
import { runSession } from '../src/session.ts';
import { loadStrategy } from '../src/strategy/interpreter.ts';

/** Every bet type must be placeable from JSON and resolve inside a session. */
describe('every bet type through the DSL', () => {
  const doc = {
    version: 1,
    id: 'kitchen-sink',
    name: 'Kitchen sink',
    unit: 5,
    table: { minBet: 5, hardwaysWorkingOnComeOut: true },
    rules: [
      { on: 'comeOut', do: [
        { action: 'bet', type: 'pass', amount: 10 },
        { action: 'bet', type: 'dontPass', amount: 10 },
      ] },
      { on: 'pointOn', do: [
        { action: 'bet', type: 'odds', on: 'pass', max: true },
        { action: 'bet', type: 'odds', on: 'dontPass', max: true },
        { action: 'bet', type: 'come', amount: 10 },
        { action: 'bet', type: 'dontCome', amount: 10 },
        { action: 'bet', type: 'place', numbers: [5, 9], amount: 10 },
        { action: 'bet', type: 'buy', numbers: [4, 10], amount: 25 },
        { action: 'bet', type: 'lay', number: 6, amount: 30 },
        { action: 'bet', type: 'place', number: 8, amount: 12 },
        { action: 'bet', type: 'big6', amount: 5 },
        { action: 'bet', type: 'big8', amount: 5 },
      ] },
      { on: 'betMoved:come', do: [{ action: 'bet', type: 'odds', on: 'come', multiple: 2 }] },
      { on: 'betMoved:dontCome', do: [{ action: 'bet', type: 'odds', on: 'dontCome', amount: 30 }] },
      { do: [
        { action: 'bet', type: 'field', amount: 5 },
        { action: 'bet', type: 'hardway', numbers: [4, 6, 8, 10], amount: 1 },
        { action: 'bet', type: 'anySeven', amount: 1 },
        { action: 'bet', type: 'anyCraps', amount: 1 },
        { action: 'bet', type: 'two', amount: 1 },
        { action: 'bet', type: 'three', amount: 1 },
        { action: 'bet', type: 'eleven', amount: 1 },
        { action: 'bet', type: 'twelve', amount: 1 },
        { action: 'bet', type: 'ce', amount: 2 },
        { action: 'bet', type: 'horn', amount: 4 },
        { action: 'bet', type: 'world', amount: 5 },
        { action: 'bet', type: 'hop', hop: [3, 4], amount: 1 },
        { action: 'bet', type: 'hop', hop: [2, 2], amount: 1 },
      ] },
    ],
  };

  test('places and resolves all bet types without rejections', () => {
    const { strategy, warnings } = loadStrategy(doc);
    expect(warnings).toEqual([]);
    // come-out 4 (point), come travels to 9, DC to 5, hard 8, 11, 2-2, 3-4 seven-out, come-out 12, 7
    const rolls = parseRolls('1-3 4-5 2-3 4-4 5-6 2-2 3-4 6-6 3-4 5-5 6-4');
    const r = runSession(strategy, { bankroll: 100000, fixedRolls: rolls, maxRolls: rolls.length, recordLog: true, rules: { maxBet: 1e6 } });
    const placed = new Set<string>();
    const resolved = new Set<string>();
    for (const l of r.log!) {
      for (const a of l.actions) {
        expect(a.startsWith('rejected')).toBe(false);
        const m = a.match(/^bet (Pass|Put|Don't Pass|Come|Don't Come|Odds|Lay odds|Place|Buy|Lay|Hard|Hop|field|anySeven|anyCraps|two|three|eleven|twelve|ce|horn|world|big6|big8)/);
        if (m) placed.add(m[1]!);
      }
      for (const o of l.outcomes) if (/won|lost|pushed|returned/.test(o)) resolved.add(o.split(' $')[0]!.replace(/ \d+$/, ''));
    }
    expect(r.rejectedBets).toBe(0);
    const expectedPlaced = ["Pass", "Don't Pass", 'Come', "Don't Come", 'Odds', 'Lay odds', 'Place', 'Buy', 'Lay', 'Hard', 'Hop', 'field', 'anySeven', 'anyCraps', 'two', 'three', 'eleven', 'twelve', 'ce', 'horn', 'world', 'big6', 'big8'];
    for (const p of expectedPlaced) expect(placed.has(p)).toBe(true);
    expect(resolved.size).toBeGreaterThan(15);
    expect(BET_TYPES.length).toBe(22);
  });
});
