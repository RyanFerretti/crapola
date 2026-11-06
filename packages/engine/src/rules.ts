/** Table rules: everything about the house that a strategy might care about. */

export type BoxNumber = 4 | 5 | 6 | 8 | 9 | 10;
export const BOX_NUMBERS: readonly BoxNumber[] = [4, 5, 6, 8, 9, 10];

export type OddsMultiples = Record<BoxNumber, number>;
export type OddsPolicy = '1x' | '2x' | '3x' | '3-4-5x' | '5x' | '10x' | '20x' | '100x' | OddsMultiples;

export interface PropPayouts {
  anySeven: number;
  anyCraps: number;
  two: number;
  three: number;
  eleven: number;
  twelve: number;
  hard4: number;
  hard6: number;
  hard8: number;
  hard10: number;
  hopEasy: number;
  hopHard: number;
}

export interface TableRules {
  /** Table minimum for line, place, field and come bets. */
  minBet: number;
  /** Table maximum for a single bet. */
  maxBet: number;
  /** Reject bets below the table minimum (props and odds are exempt). */
  enforceMinimums: boolean;
  oddsPolicy: OddsPolicy;
  /** Field multipliers on 2 and 12 (1 = even money). */
  fieldPays: { two: number; twelve: number };
  /** Which craps total pushes for don't bets. */
  dontBar: 2 | 12;
  placeWorkingOnComeOut: boolean;
  buyWorkingOnComeOut: boolean;
  hardwaysWorkingOnComeOut: boolean;
  comeOddsWorkingOnComeOut: boolean;
  layWorkingOnComeOut: boolean;
  dontComeOddsWorkingOnComeOut: boolean;
  buyVig: 'on-win' | 'up-front';
  layVig: 'on-win' | 'up-front';
  vigRate: number;
  vigMinimum: number;
  /** Casinos pay to the dollar; 'exact' keeps fractions. */
  payoutRounding: 'floor' | 'exact';
  allowPutBets: boolean;
  propPayouts: PropPayouts;
}

export const DEFAULT_RULES: TableRules = {
  minBet: 10,
  maxBet: 5000,
  enforceMinimums: true,
  oddsPolicy: '3-4-5x',
  fieldPays: { two: 2, twelve: 3 },
  dontBar: 12,
  placeWorkingOnComeOut: false,
  buyWorkingOnComeOut: false,
  hardwaysWorkingOnComeOut: false,
  comeOddsWorkingOnComeOut: false,
  layWorkingOnComeOut: true,
  dontComeOddsWorkingOnComeOut: true,
  buyVig: 'on-win',
  layVig: 'on-win',
  vigRate: 0.05,
  vigMinimum: 1,
  payoutRounding: 'floor',
  allowPutBets: true,
  propPayouts: {
    anySeven: 4,
    anyCraps: 7,
    two: 30,
    three: 15,
    eleven: 15,
    twelve: 30,
    hard4: 7,
    hard6: 9,
    hard8: 9,
    hard10: 7,
    hopEasy: 15,
    hopHard: 30,
  },
};

export function mergeRules(...layers: Array<Partial<TableRules> | undefined>): TableRules {
  let out: TableRules = { ...DEFAULT_RULES };
  for (const layer of layers) {
    if (!layer) continue;
    const defined = Object.fromEntries(Object.entries(layer).filter(([, v]) => v !== undefined)) as Partial<TableRules>;
    out = {
      ...out,
      ...defined,
      fieldPays: { ...out.fieldPays, ...(layer.fieldPays ?? {}) },
      propPayouts: { ...out.propPayouts, ...(layer.propPayouts ?? {}) },
    };
  }
  return out;
}

export function oddsMultiples(policy: OddsPolicy): OddsMultiples {
  if (typeof policy === 'object') return policy;
  if (policy === '3-4-5x') return { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };
  const n = parseInt(policy, 10);
  return { 4: n, 5: n, 6: n, 8: n, 9: n, 10: n };
}

export function isBoxNumber(n: unknown): n is BoxNumber {
  return n === 4 || n === 5 || n === 6 || n === 8 || n === 9 || n === 10;
}
