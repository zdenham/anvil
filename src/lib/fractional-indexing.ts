/**
 * Fractional indexing for lexicographic sort keys.
 * Generates string keys that sort between any two adjacent keys.
 *
 * Used by the tree builder for sort ordering and by DnD (05a) for
 * key generation on drop.
 *
 * Reference: fractional-indexing npm package by @rocicorp.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length; // 62

function indexOf(c: string): number {
  const i = DIGITS.indexOf(c);
  if (i === -1) throw new Error(`Invalid fractional index character: ${c}`);
  return i;
}

/**
 * Compute the lexicographic midpoint between two strings using base-62 digits.
 * Both strings must consist only of characters from DIGITS.
 */
function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined && a >= b) {
    throw new Error(`midpoint: a must be less than b (a=${a}, b=${b})`);
  }

  // Pad to equal length
  const maxLen = Math.max(a.length, b?.length ?? 0);
  const padA = a.padEnd(maxLen, DIGITS[0]);
  const padB = b?.padEnd(maxLen, DIGITS[BASE - 1]) ?? "";

  let result = "";
  let carry = false;

  for (let i = 0; i < maxLen; i++) {
    const digitA = indexOf(padA[i]);
    const digitB = b !== undefined ? indexOf(padB[i]) : BASE - 1;

    if (digitA === digitB) {
      result += DIGITS[digitA];
      continue;
    }

    const mid = Math.floor((digitA + digitB) / 2);
    if (mid > digitA) {
      result += DIGITS[mid];
      carry = true;
      break;
    }
    // Adjacent digits — carry to next position
    result += DIGITS[digitA];
  }

  if (!carry) {
    // All digits were equal or adjacent — append midpoint of remaining range
    result += DIGITS[Math.floor(BASE / 2)];
  }

  return result;
}

/**
 * Generate a sort key between `before` and `after`.
 * Pass null/undefined for unbounded ends.
 *
 * Examples:
 * - generateKeyBetween(null, null)     -> "a0" (first item)
 * - generateKeyBetween(null, "a0")     -> key < "a0"
 * - generateKeyBetween("a0", null)     -> key > "a0"
 * - generateKeyBetween("a0", "a1")     -> key between "a0" and "a1"
 */
export function generateKeyBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  if (before === null || before === undefined) {
    if (after === null || after === undefined) {
      return "a0";
    }
    // Generate key before `after`
    return midpoint(DIGITS[0], after);
  }

  if (after === null || after === undefined) {
    // Generate key after `before` — increment last digit or append
    return midpoint(before, undefined);
  }

  // Both bounds present
  return midpoint(before, after);
}

/**
 * Generate N keys evenly spaced between `before` and `after`.
 */
export function generateNKeysBetween(
  before: string | null | undefined,
  after: string | null | undefined,
  count: number,
): string[] {
  const keys: string[] = [];
  let lower = before ?? null;
  for (let i = 0; i < count; i++) {
    const upper = i === count - 1 ? (after ?? null) : null;
    const key = generateKeyBetween(lower, upper);
    keys.push(key);
    lower = key;
  }
  return keys;
}
