/**
 * skipRows -- the PURE "skip rows after header" leaf for the BoQ wizard header-config panel.
 *
 * The "Skip rows after header" field is a structured list of SkipDefinitions (each a single row
 * or an inclusive row range) instead of the legacy single comma-list. This module owns the tricky
 * round-trip + derivation logic so the (large) panel component stays clean and these bits are
 * unit-tested in isolation:
 *   - resolveSkipDefinitions: flatten the structured list -> a sorted, deduped row-number set;
 *   - firstDataRow: the true first data row, stepping past skips CONTIGUOUS with the header;
 *   - defsFromLegacyList: reconstruct the structured editor from an old flat skip list.
 *
 * PURE -- no React/DOM/Frappe; imports only the SkipDefinition type. Unit-tested in
 * skipRows.test.ts.
 */
import type { SkipDefinition } from "./boqTypes";

/** A finite integer >= 1 -- the validity floor for a row number (rows are 1-based). */
function isValidRow(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}

/**
 * Flatten a structured skip list into a sorted, de-duplicated ascending array of row numbers.
 * Invalid entries are dropped (never throw):
 *   - a single with row < 1 or a non-integer/NaN row;
 *   - a range with start < 1, end < start, or a non-integer/NaN endpoint.
 * A valid range is INCLUSIVE of both ends. Overlapping definitions dedupe (the result is a set).
 */
export function resolveSkipDefinitions(defs: SkipDefinition[]): number[] {
  const rows = new Set<number>();
  for (const def of defs) {
    if (def.kind === "single") {
      if (isValidRow(def.row)) rows.add(def.row);
    } else {
      // range: both endpoints must be valid rows and end must not precede start.
      if (isValidRow(def.start) && isValidRow(def.end) && def.end >= def.start) {
        for (let r = def.start; r <= def.end; r++) rows.add(r);
      }
    }
  }
  return [...rows].sort((a, b) => a - b);
}

/**
 * The true first data row, given the header row and the resolved (sorted) skip-row set.
 *
 * Starts at `headerRow + 1`, then advances past any skip rows CONTIGUOUS with the header: while
 * the candidate is in `resolvedSkips`, increment by 1; stop at the first row NOT in the set. A
 * GAP in the skip set is a hard stop -- it does NOT jump the gap.
 *   headerRow=2, skips=[3,4,5]  -> 6   (3,4,5 are contiguous with the header)
 *   headerRow=2, skips=[]       -> 3
 *   headerRow=2, skips=[4,5]    -> 3   (gap at 3 -> stop before it; skips not adjacent to header)
 *
 * `resolvedSkips` is the ascending array from resolveSkipDefinitions. Membership is via a Set, so
 * order is not relied on. CHOICE: if `headerRow` is not a positive integer (e.g. unset/0), there
 * is no meaningful first data row, so we return NaN rather than a bogus `headerRow + 1` -- the
 * panel treats NaN as "no first data row yet" (consistent with the resolve* validity floor).
 */
export function firstDataRow(headerRow: number, resolvedSkips: number[]): number {
  if (!isValidRow(headerRow)) return NaN;
  const skipped = new Set(resolvedSkips);
  let candidate = headerRow + 1;
  while (skipped.has(candidate)) candidate++;
  return candidate;
}

/**
 * Reconstruct the structured editor from an old flat skip list (the legacy
 * skip_top_rows_after_header values) when no structured form was saved. Each row number >= 1 maps
 * to a `{ kind: "single", row }` definition, preserving order; invalid (non-integer/NaN/< 1)
 * entries are dropped.
 */
export function defsFromLegacyList(rows: number[]): SkipDefinition[] {
  const out: SkipDefinition[] = [];
  for (const row of rows) {
    if (isValidRow(row)) out.push({ kind: "single", row });
  }
  return out;
}
