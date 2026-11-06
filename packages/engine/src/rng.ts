/** Deterministic dice sources. Every session gets its own seed so strategies can be compared on identical dice. */

export interface Roll {
  d1: number;
  d2: number;
  total: number;
  hard: boolean;
}

export interface DiceSource {
  roll(): Roll;
}

export function makeRoll(d1: number, d2: number): Roll {
  return { d1, d2, total: d1 + d2, hard: d1 === d2 };
}

/** mulberry32: small, fast, good enough for dice. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a per-session seed from a base seed and a session index. */
export function deriveSeed(base: number, index: number): number {
  let h = (base ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h + Math.imul(index + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export class SeededDice implements DiceSource {
  private readonly next: () => number;
  constructor(public readonly seed: number) {
    this.next = mulberry32(seed);
  }
  roll(): Roll {
    const d1 = 1 + Math.floor(this.next() * 6);
    const d2 = 1 + Math.floor(this.next() * 6);
    return makeRoll(d1, d2);
  }
}

/** Plays a fixed sequence first, then falls back to another source (or throws). */
export class FixedDice implements DiceSource {
  private i = 0;
  constructor(
    private readonly rolls: ReadonlyArray<readonly [number, number]>,
    private readonly fallback?: DiceSource,
  ) {}
  get remaining(): number {
    return this.rolls.length - this.i;
  }
  roll(): Roll {
    const r = this.rolls[this.i];
    if (r) {
      this.i++;
      return makeRoll(r[0], r[1]);
    }
    if (this.fallback) return this.fallback.roll();
    throw new Error('FixedDice exhausted');
  }
}

/**
 * Parse a roll script. Items are comma or space separated:
 *   "4-4"  explicit dice        "44"  two digits (10, 11, 12 are read as totals; use "1-1" for aces)
 *   "8"    canonical easy way   "H8"  hard way
 */
export function parseRolls(script: string): Array<[number, number]> {
  const canonical: Record<number, [number, number]> = {
    2: [1, 1], 3: [1, 2], 4: [1, 3], 5: [2, 3], 6: [2, 4], 7: [3, 4],
    8: [3, 5], 9: [4, 5], 10: [4, 6], 11: [5, 6], 12: [6, 6],
  };
  const out: Array<[number, number]> = [];
  for (const raw of script.split(/[\s,]+/)) {
    const item = raw.trim();
    if (!item) continue;
    let m: RegExpMatchArray | null;
    if ((m = item.match(/^([1-6])-([1-6])$/))) out.push([+m[1]!, +m[2]!]);
    else if ((m = item.match(/^(1[0-2])$/))) out.push(canonical[+m[1]!]!);
    else if ((m = item.match(/^([1-6])([1-6])$/))) out.push([+m[1]!, +m[2]!]);
    else if ((m = item.match(/^[hH](4|6|8|10)$/))) {
      const half = +m[1]! / 2;
      out.push([half, half]);
    } else if ((m = item.match(/^(\d{1,2})$/)) && canonical[+m[1]!]) out.push(canonical[+m[1]!]!);
    else throw new Error(`Cannot parse roll "${item}"`);
  }
  return out;
}
