/**
 * A small seeded random generator for property tests. Every failure is reproducible from
 * the seed in the test name; nothing here touches `Math.random`.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p = 0.5): boolean {
    return this.next() < p;
  }

  /** One element of a non-empty list. */
  pick<V>(items: readonly V[]): V {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error('pick() needs a non-empty list');
    return item;
  }

  /** A string of `length` characters drawn from `alphabet`. */
  string(length: number, alphabet = 'abcdefghijklmnopqrstuvwxyz'): string {
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet.charAt(this.int(0, alphabet.length - 1));
    return out;
  }

  /** A sentence of `words` lower-case words. */
  words(words: number): string {
    return Array.from({ length: words }, () => this.string(this.int(2, 9))).join(' ');
  }
}

/** Runs `body` once per seed, labelling each run so a failure names the seed to replay. */
export function forSeeds(count: number, body: (rng: Prng, seed: number) => void): void {
  for (let seed = 1; seed <= count; seed++) {
    try {
      body(new Prng(seed), seed);
    } catch (error) {
      throw new Error(`property failed for seed ${seed}`, { cause: error });
    }
  }
}
