import { describe, expect, test } from 'bun:test';
import { parseRolls } from '../src/rng.ts';
import { runSession } from '../src/session.ts';
import type { DecisionContext, Strategy } from '../src/strategy/types.ts';

function codeStrategy(id: string, decide: (ctx: DecisionContext) => void): Strategy {
  return { id, name: id, createSession: () => ({ decide }) };
}

describe('session accounting', () => {
  test('pass line with max odds, scripted dice', () => {
    const strat = codeStrategy('pass-odds', ({ api, table }) => {
      if (table.point === null) api.bet({ type: 'pass', amount: 10 });
      else api.bet({ type: 'odds', on: 'pass', amount: 50 });
    });
    // come-out 6, then 6 again: pass wins 10, odds (capped at 5x = 50) win 60
    const r = runSession(strat, { bankroll: 500, fixedRolls: parseRolls('6 H6'), maxRolls: 2, recordLog: true });
    expect(r.profit).toBe(70);
    expect(r.rolls).toBe(2);
    expect(r.endReason).toBe('maxRolls');
  });

  test('seven out loses place bets and ends the shooter', () => {
    const strat = codeStrategy('place68', ({ api, table, player }) => {
      if (table.point !== null) {
        // The low-level api stacks same-slot bets, so check first.
        for (const n of [6, 8]) if (!player.bets.some((b) => b.type === 'place' && b.number === n)) api.bet({ type: 'place', number: n, amount: 12 });
      }
    });
    const r = runSession(strat, { bankroll: 200, fixedRolls: parseRolls('4 8 6 7'), maxShooters: 1 });
    // 8 pays 14, 6 pays 14, 7 loses 24 => +4
    expect(r.profit).toBe(4);
    expect(r.shooters).toBe(1);
    expect(r.endReason).toBe('maxShooters');
  });

  test('come odds are returned when the come bet resolves on a come-out', () => {
    const strat = codeStrategy('come-odds', ({ api, table, player }) => {
      if (table.point === null && !player.bets.some((b) => b.type === 'pass')) api.bet({ type: 'pass', amount: 10 });
      if (table.point !== null) {
        if (!player.bets.some((b) => b.type === 'come')) api.bet({ type: 'come', amount: 10 });
        api.bet({ type: 'odds', on: 'come', amount: 20 });
      }
    });
    // point 4; come travels to 8 with 20 odds; point made with a 4 (pass +10); come-out 7: come loses 10, odds returned
    const r = runSession(strat, { bankroll: 500, fixedRolls: parseRolls('4 8 4 7'), maxRolls: 4, recordLog: true });
    // Roll 4: pass -> point. Roll 8: come -> 8, then odds 20 placed. Roll 4: pass wins +10; a new come bet (10) is placed? No: point is now off.
    // Roll 7 (come-out): pass bet (new, 10) wins +10, come on 8 loses -10, odds returned, pass placed again.
    expect(r.log!.map((l) => l.outcomes.join('; '))).toEqual([
      '',
      'Pass $10 (4)',
      'Come $10 on 8',
      'Pass $10 (4) won $10',
      'Come $10 on 8 lost; Pass $10 won $10; Odds $20 on 8 (come) returned',
    ]);
    expect(r.profit).toBe(10);
  });

  test('stop loss triggers a wind-down and takes removable bets down', () => {
    const strat = codeStrategy('field-forever', ({ api }) => api.bet({ type: 'field', amount: 100 }));
    const r = runSession(strat, { bankroll: 300, stopLoss: 150, fixedRolls: parseRolls('7 7 7 7 7 7') });
    expect(r.endReason).toBe('stopLoss');
    expect(r.profit).toBe(-200);
    expect(r.rolls).toBe(2);
  });

  test('busting ends the session', () => {
    const strat = codeStrategy('all-in', ({ api, player }) => api.bet({ type: 'anySeven', amount: player.bankroll }));
    const r = runSession(strat, { bankroll: 100, fixedRolls: parseRolls('8 8') });
    expect(r.endReason).toBe('busted');
    expect(r.endBankroll).toBe(0);
  });

  test('same seed gives the same result', () => {
    const strat = codeStrategy('pass', ({ api, table }) => {
      if (table.point === null) api.bet({ type: 'pass', amount: 10 });
    });
    const a = runSession(strat, { bankroll: 300, seed: 99, maxShooters: 20 });
    const b = runSession(strat, { bankroll: 300, seed: 99, maxShooters: 20 });
    expect(a.profit).toBe(b.profit);
    expect(a.rolls).toBe(b.rolls);
  });
});
