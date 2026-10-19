/**
 * stableOrder -- the display order of the column-map screen's mapped rows (S6 F9 / U8). Pure.
 *
 * Before S6 the rows were re-sorted by column letter on every change, so picking a column moved
 * the row under the cursor and the next click landed on a different role. Now a row stays where
 * it is: kept keys keep their place, a renamed key (A -> F) takes its old key's place, and new
 * keys go at the end (in letter order among themselves). With no previous order (first load) the
 * keys come in letter order, as before.
 */
export function stableOrder(
  prev: readonly string[],
  keys: readonly string[],
  rename: { from: string; to: string } | null,
  sort: (cols: string[]) => string[],
): string[] {
  const present = new Set(keys);
  if (prev.length === 0) return sort([...keys]);
  const out: string[] = [];
  for (const k of prev) {
    const now = rename && k === rename.from ? rename.to : k;
    if (present.has(now) && !out.includes(now)) out.push(now);
  }
  const added = keys.filter((k) => !out.includes(k));
  return [...out, ...sort(added)];
}
