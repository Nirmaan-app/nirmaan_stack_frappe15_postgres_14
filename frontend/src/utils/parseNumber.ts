/**
 * Parses a value (string, number, undefined, float) to a number, retaining decimals.
 * Returns 0 if the parsed value is undefined or NaN.
 *
 * @param {string|number|undefined|null} value - The value to parse.
 * @returns {number} - The parsed number, or 0 if parsing fails.
 */
export const parseNumber = (value: string | number | undefined | null): number => {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}