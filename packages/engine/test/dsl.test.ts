import { describe, expect, test } from 'bun:test';
import { parseRolls } from '../src/rng.ts';
import { runSession } from '../src/session.ts';
import { evalExpr, parseExpr } from '../src/strategy/expr/index.ts';
import { loadStrategy, validateStrategyDoc } from '../src/strategy/interpreter.ts';

const scope = {
  unit: 5,
  get: (n: string) => ({ unit: 5, point: 6, pointOn: true, bankroll: 500, level: 2 })[n],
  call: (n: string, a: unknown[]) => (n === 'max' ? Math.max(...(a as number[])) : n === 'hasBet' ? a[0] === 'place' && a[1] === 6 : 0),
};

describe('expressions', () => {
  test('arithmetic, units, precedence', () => {
    expect(evalExpr('2 + 3 * 4', scope)).toBe(14);
    expect(evalExpr('2u', scope)).toBe(10);
    expect(evalExpr('unit * level', scope)).toBe(10);
    expect(evalExpr('-(1 + 2) * 2', scope)).toBe(-6);
    expect(evalExpr('10 / 4', scope)).toBe(2.5);
  });
  test('booleans and comparisons', () => {
    expect(evalExpr("pointOn && !hasBet('place', 6)", scope)).toBe(false);
    expect(evalExpr("pointOn && !hasBet('place', 8)", scope)).toBe(true);
    expect(evalExpr('point == 6 || point == 8', scope)).toBe(true);
    expect(evalExpr('bankroll >= 1000 ? 25 : 10', scope)).toBe(10);
    expect(evalExpr('max(3, 9, 4)', scope)).toBe(9);
  });
  test('parse errors are reported', () => {
    expect(() => parseExpr('1 +')).toThrow();
    expect(() => parseExpr("hasBet('place'")).toThrow();
  });
});

const baseDoc = {
  version: 1,
  id: 'test',
  name: 'Test',
  unit: 10,
  table: { minBet: 5 },
  variables: { level: 1 },
  rules: [] as unknown[],
};

describe('validation', () => {
  test('rejects unknown identifiers and triggers', () => {
    const v = validateStrategyDoc({
      ...baseDoc,
      rules: [
        { on: 'nope', when: 'foo > 1', do: [{ action: 'bet', type: 'pass', amount: 10 }] },
        { do: [{ action: 'bet', type: 'place', amount: 10 }] },
        { do: [{ action: 'bet', type: 'odds', amount: 10 }] },
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const msgs = v.issues.map((i) => i.message).join('\n');
      expect(msgs).toContain('unknown trigger "nope"');
      expect(msgs).toContain('unknown identifier "foo"');
      expect(msgs).toContain('needs "number"');
      expect(msgs).toContain('odds need "on"');
    }
  });
  test('accepts a sound document', () => {
    const v = validateStrategyDoc({
      ...baseDoc,
      rules: [{ on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: '1u' }] }],
    });
    expect(v.ok).toBe(true);
  });
});

function run(rules: unknown[], rolls: string, extra: Record<string, unknown> = {}, bankroll = 1000) {
  const { strategy } = loadStrategy({ ...baseDoc, ...extra, rules });
  return runSession(strategy, { bankroll, fixedRolls: parseRolls(rolls), maxRolls: parseRolls(rolls).length, recordLog: true });
}

describe('interpreter', () => {
  test('ensure semantics do not re-bet; place inside skipping the point', () => {
    const r = run(
      [
        { on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: '1u' }] },
        { on: 'pointEstablished', do: [{ action: 'bet', type: 'place', numbers: 'inside', skipPoint: true, amount: '1u' }] },
      ],
      '5 3 8 6',
    );
    const after = r.log![1]!.betsAfter;
    expect(after).toEqual(['Pass $10 (5)', 'Place 6 $12', 'Place 8 $12', 'Place 9 $10']);
    // 3 is nothing; 8 pays 14, 6 pays 14; nothing re-bet
    expect(r.profit).toBe(28);
    expect(r.log![3]!.actions).toEqual([]);
  });

  test('press with winnings rounds down to the increment', () => {
    const r = run(
      [
        { on: 'pointEstablished', do: [{ action: 'bet', type: 'place', numbers: [6, 8], amount: 12 }] },
        { on: 'betWon:place', do: [{ action: 'press', target: 'self' }] },
      ],
      '4 6 6 3',
    );
    // 6 pays 14 -> press to 24 (keep 2); next 6 pays 28 -> press to 48 (keep 4)
    expect(r.log![1]!.betsAfter).toContain('Place 6 $12');
    expect(r.log![2]!.betsAfter).toContain('Place 6 $24');
    expect(r.log![3]!.betsAfter).toContain('Place 6 $48');
    expect(r.profit).toBe(14 + 28); // stakes on the table come back at the end
  });

  test('variables, once per shooter, and bet-event triggers with filters', () => {
    const r = run(
      [
        // Rules run in order: update the level first, then bet with it.
        { on: 'betLost:dontPass', do: [{ action: 'increment', var: 'level' }] },
        { on: 'betWon:dontPass', do: [{ action: 'set', var: 'level', value: 1 }] },
        { on: 'comeOut', do: [{ action: 'bet', type: 'dontPass', amount: 'unit * level' }] },
        { on: 'newShooter', once: 'shooter', do: [{ action: 'log', message: 'shooter {shooter} level {level}' }] },
      ],
      '7 11 3 4 7 6 6',
    );
    // 7 loses 10 (level 2), 11 loses 20 (level 3), 3 wins 30 (level 1), 4 point, 7 wins 10 -> new shooter, 6 point, 6 loses 10
    expect(r.log![0]!.logs).toEqual(['shooter 1 level 1']);
    expect(r.log![1]!.state!.level).toBe(2);
    expect(r.log![1]!.betsAfter).toEqual(["Don't Pass $20"]);
    expect(r.log![2]!.state!.level).toBe(3);
    expect(r.log![3]!.state!.level).toBe(1);
    expect(r.log![5]!.logs).toEqual(['shooter 2 level 1']);
    expect(r.profit).toBe(-10 - 20 + 30 + 10 - 10);
  });

  test('odds with max and multiple, come bets, take down', () => {
    const r = run(
      [
        { on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: 10 }] },
        { on: 'pointOn', do: [{ action: 'bet', type: 'odds', on: 'pass', max: true }] },
        { on: 'pointOn', when: "betCount('come') < 2", do: [{ action: 'bet', type: 'come', amount: 10 }] },
        { on: 'betMoved:come', do: [{ action: 'bet', type: 'odds', on: 'come', multiple: 2 }] },
        { on: 'sevenOut', do: [{ action: 'takeDown', target: 'all' }] },
      ],
      '4 5 9 5',
    );
    expect(r.log![1]!.betsAfter).toEqual(['Pass $10 (4)', 'Odds $30 on 4 (pass)', 'Come $10']);
    expect(r.log![2]!.betsAfter).toEqual(['Pass $10 (4)', 'Odds $30 on 4 (pass)', 'Come $10 on 5', 'Come $10', 'Odds $20 on 5 (come)']);
    // roll 9: second come travels to 9 (+20 odds). roll 5: come on 5 wins 10 + odds 30
    expect(r.log![4]!.outcomes.join(' ')).toContain('Come $10 on 5 won $10');
    expect(r.log![4]!.outcomes.join(' ')).toContain('Odds $20 on 5 (come) won $30');
  });

  test('sitOut until next shooter suspends betting', () => {
    const r = run(
      [
        { on: 'sessionStart', do: [{ action: 'sitOut', until: 'nextShooter' }] },
        { on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: 10 }] },
      ],
      '6 7 8 8',
    );
    expect(r.log![0]!.betsAfter).toEqual([]);
    expect(r.log![2]!.betsAfter).toEqual(['Pass $10']);
    expect(r.profit).toBe(10);
  });

  test('walkAway after a win goal expressed as a rule', () => {
    const r = run(
      [
        { on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: 100 }] },
        { when: 'profit >= 200', do: [{ action: 'walkAway' }] },
      ],
      '7 7 7 7 7',
    );
    expect(r.endReason).toBe('walkedAway');
    expect(r.profit).toBe(200);
  });
});

describe('expression-valued number', () => {
  test('generic press of the hardway behind a place win', () => {
    const r = run(
      [
        { on: 'pointEstablished', do: [{ action: 'bet', type: 'place', numbers: [6, 8], amount: 12 }, { action: 'bet', type: 'hardway', numbers: [6, 8], amount: 10 }] },
        { on: 'betWon:place', do: [{ action: 'bet', type: 'hardway', number: 'bet.number', amount: 'bet.payout', mode: 'add' }] },
      ],
      '4 3-5 2-4 3',
    );
    // easy 8: the hard 8 loses and place 8 pays 14, which buys a fresh hard 8 of $14; same for the easy 6
    expect(r.log![2]!.betsAfter).toContain('Hard 8 $14');
    expect(r.log![3]!.betsAfter).toContain('Hard 6 $14');
  });
});

describe('agent-reported edge cases', () => {
  test('walkAway stops later rules in the same decision point', () => {
    const r = run(
      [
        { on: 'sessionStart', do: [{ action: 'walkAway', mode: 'rideOut' }] },
        { on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: 10 }] },
      ],
      '7 7',
    );
    expect(r.endReason).toBe('walkedAway');
    expect(r.profit).toBe(0);
    expect(r.log![0]!.betsAfter).toEqual([]);
  });

  test('hasBet with number 0 finds a pending come bet', () => {
    const r = run(
      [
        { on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: 10 }] },
        { on: 'pointOn', when: "!hasBet('come', 0) && betCount('come') - betCount('come', 0) < 1", do: [{ action: 'bet', type: 'come', amount: 10 }] },
        { on: 'pointOn', when: "hasBet('come', 0)", do: [{ action: 'log', message: 'come pending' }] },
      ],
      '4 5 9 3',
    );
    // the come goes up, then the next rule sees it pending in the same decision point
    expect(r.log![1]!.logs).toEqual(['come pending']);
    expect(r.log![1]!.betsAfter).toEqual(['Pass $10 (4)', 'Come $10']);
    // after the come travels to 5, no second come goes up and nothing is pending
    expect(r.log![2]!.logs).toEqual([]);
    expect(r.log![2]!.betsAfter).toEqual(['Pass $10 (4)', 'Come $10 on 5']);
  });

  test('a strategy that cannot fund its bets busts instead of idling', () => {
    const { strategy } = loadStrategy({ ...baseDoc, unit: 100, rules: [{ on: 'comeOut', do: [{ action: 'bet', type: 'pass', amount: 100 }] }] });
    const r = runSession(strategy, { bankroll: 150, seed: 3, maxShooters: 50, fixedRolls: parseRolls('7 2 2 2 4 7 5 7') });
    expect(r.endReason).toBe('busted');
    expect(r.endBankroll).toBeLessThan(100);
    expect(r.shooters).toBeLessThan(50);
  });
});

describe('if/else chains', () => {
  test('action-level when and rule stop', () => {
    const r = run(
      [
        { on: 'pointEstablished', do: [{ action: 'bet', type: 'place', numbers: [6, 8], amount: 12 }] },
        {
          id: 'spend-the-win',
          on: 'betWon:place',
          stop: true,
          do: [
            { action: 'bet', type: 'place', number: 5, amount: 10, when: "!hasBet('place', 5)" },
            { action: 'bet', type: 'place', number: 9, amount: 10, when: "hasBet('place', 5) && !hasBet('place', 9)" },
            { action: 'log', message: 'collect', when: "hasBet('place', 5) && hasBet('place', 9)" },
          ],
        },
        { on: 'betWon:place', do: [{ action: 'log', message: 'never reached' }] },
      ],
      '4 6 8 6 6 3',
    );
    expect(r.log![2]!.betsAfter).toEqual(['Place 6 $12', 'Place 8 $12', 'Place 5 $10']);
    expect(r.log![3]!.betsAfter).toEqual(['Place 6 $12', 'Place 8 $12', 'Place 5 $10', 'Place 9 $10']);
    expect(r.log![4]!.logs).toEqual(['collect']);
    expect(r.log!.flatMap((l) => l.logs)).not.toContain('never reached');
  });

  test('failed presses are reported as rejections', () => {
    const { strategy } = loadStrategy({
      ...baseDoc,
      rules: [
        { on: 'pointEstablished', do: [{ action: 'bet', type: 'place', number: 6, amount: 12 }] },
        { on: 'betWon:place:6', do: [{ action: 'press', target: 'self', by: 500 }] },
      ],
    });
    const r = runSession(strategy, { bankroll: 100, fixedRolls: parseRolls('4 6 3'), recordLog: true });
    expect(r.rejectedBets).toBe(1);
    expect(r.log![2]!.actions.join(' ')).toContain('rejected press');
  });

  test('up-front vig comes back when a buy bet is taken down', () => {
    const { strategy } = loadStrategy({
      ...baseDoc,
      table: { minBet: 5, buyVig: 'up-front' },
      rules: [
        { on: 'pointEstablished', do: [{ action: 'bet', type: 'buy', number: 4, amount: 25 }] },
        { on: 'roll', when: "hasBet('buy', 4) && rollsSincePoint >= 1", do: [{ action: 'takeDown', target: 'buy:4' }] },
      ],
    });
    const r = runSession(strategy, { bankroll: 100, fixedRolls: parseRolls('6 3 5'), recordLog: true });
    expect(r.log![1]!.bankroll).toBe(74);
    expect(r.log![2]!.bankroll).toBe(100);
    expect(r.totalVig).toBe(0);
  });
});
