import { createHash, randomInt } from 'node:crypto';

export const randomInteger = (min, max) => randomInt(min, max + 1);

// Rejection sampling avoids modulo bias, including for small ranges like 252.
export function uniformInteger(nextWord, min, max) {
  const range = max - min + 1;
  if (!Number.isSafeInteger(range) || range < 1 || range > 2 ** 32)
    throw new RangeError('invalid_random_range');
  const ceiling = Math.floor(2 ** 32 / range) * range;
  let value;
  do { value = nextWord(); } while (value >= ceiling);
  return min + value % range;
}

export function seededInteger(seed) {
  let counter = 0;
  return (min, max) => uniformInteger(() => createHash('sha256')
    .update(JSON.stringify([seed, counter++])).digest().readUInt32BE(0), min, max);
}
