// Randomness: node:crypto.randomBytes only (PL1-C-06).
import { randomBytes as nodeRandomBytes } from "node:crypto";

export function randomBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n <= 0)
    throw new RangeError("randomBytes: n must be a positive integer");
  return new Uint8Array(nodeRandomBytes(n));
}

/** Uniform integer in [0, max) by rejection sampling (no modulo bias). */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32)
    throw new RangeError("randomInt: bad max");
  const limit = Math.floor(2 ** 32 / max) * max;
  for (;;) {
    const b = randomBytes(4);
    const v =
      ((b[0] as number) * 2 ** 24 +
        ((b[1] as number) << 16) +
        ((b[2] as number) << 8) +
        (b[3] as number)) >>>
      0;
    if (v < limit) return v % max;
  }
}
