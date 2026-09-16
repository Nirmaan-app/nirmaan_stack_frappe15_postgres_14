/**
 * Shorten a value to at most `max` characters, ending in an ellipsis.
 *
 * For plain-text surfaces a hover cannot reach (a toast). On screen, prefer
 * `<TruncatedText>`, which keeps the full value in a tooltip.
 */
export function ellipsize(text: string | null | undefined, max: number): string {
  const value = text ?? "";
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
