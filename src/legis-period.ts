/** Legislative periods ("Gesetzgebungsperioden") are written in roman numerals: XXVIII = 28th period. */

const NUMERALS: ReadonlyArray<readonly [string, number]> = [
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1],
];
const MAX_PERIOD = 40;

export function toRoman(n: number): string {
  let rest = n;
  let out = '';
  for (const [symbol, value] of NUMERALS) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

/** Strict parse: the text must be the canonical roman form of the number it parses to ("IIII" is rejected). */
function fromRoman(s: string): number {
  let i = 0;
  let total = 0;
  while (i < s.length) {
    const entry = NUMERALS.find(([symbol]) => s.startsWith(symbol, i));
    if (!entry) return NaN;
    total += entry[1];
    i += entry[0].length;
  }
  return toRoman(total) === s ? total : NaN;
}

/** Accepts 28, "28", "XXVIII" or "xxviii"; returns "XXVIII". Throws a German message for anything else. */
export function parseLegisPeriod(input: string | number): string {
  const s = String(input).trim().toUpperCase();
  const n = /^\d{1,2}$/.test(s) ? Number(s) : fromRoman(s);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PERIOD) {
    throw new Error(`Ungültige Gesetzgebungsperiode: ${String(input)}. Erlaubt: 1-${MAX_PERIOD} oder römisch, z. B. XXVIII.`);
  }
  return toRoman(n);
}
