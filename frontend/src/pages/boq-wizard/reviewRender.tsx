/**
 * reviewRender -- shared review-screen render helpers (BoQ Phase 5 Slice 2).
 *
 * Extracted VERBATIM (byte-identical bodies, zero behaviour change) from ReviewTree.tsx
 * so a future pricing grid (Slice 3a) can reuse the SAME render logic instead of
 * duplicating ReviewTree's ~2580 lines. Importers: ReviewTree.tsx + exportReviewCsv.ts.
 *
 * Exports: computeDepths, resolveDescriptorValue, renderDescriptorCell (the three pure
 * functions, characterization-tested in reviewRender.test.ts), ClassificationPill (the
 * presentational pill -- manual-cert only, no DOM unit test) + CLS_LABELS (the
 * classification label map, also consumed by exportReviewCsv). fmtNum + CLS_PILL_CLASSES
 * are module-private (single internal callers).
 *
 * This is a .tsx module (not .ts) because ClassificationPill returns JSX. Uses the
 * automatic JSX runtime (no `import React`), matching ReviewTree.tsx.
 */
import { cn } from "@/lib/utils";
import type { ReviewRow, ColumnDescriptor } from "./boqTypes";

// ── Depth computation (verbatim from B1) ──────────────────────────────────────
//
// Builds a Map<row_index, depth> for all rows. Root rows (effective_parent_index
// null) get depth 0. Each child is one deeper than its parent.
//
// Algorithm: iterative chain-walk per row, memoized. For each row we walk up
// through effective_parent_index until we hit null (root), a pre-computed depth,
// or a cycle (visited set). Cycle members receive depth 0.
//
// Time: O(n) amortised -- each node is visited once via memoisation.

// Exported for reuse by exportReviewCsv (Slice D2) -- single source of truth for
// the effective depth shown in the tree. No behaviour change.
export function computeDepths(rows: ReviewRow[]): Map<number, number> {
  const byIdx = new Map<number, ReviewRow>(rows.map(r => [r.row_index, r]));
  const depths = new Map<number, number>();

  const depthOf = (startIdx: number): number => {
    if (depths.has(startIdx)) return depths.get(startIdx)!;

    // Build the upward chain from startIdx toward the root.
    // chain[0] = startIdx, chain[1] = startIdx's parent, ..., chain[last] = root.
    const chain: number[] = [];
    const seen = new Set<number>();
    let cur: number | null = startIdx;

    while (cur !== null) {
      if (depths.has(cur)) {
        // We hit a node whose depth is already known.
        // Fill the chain in reverse: chain is [startIdx, ..., childOfCur].
        // childOfCur is depth(cur)+1, ..., startIdx is depth(cur)+chain.length.
        let d = depths.get(cur)!;
        for (let i = chain.length - 1; i >= 0; i--) {
          d += 1;
          depths.set(chain[i], d);
        }
        return depths.get(startIdx)!;
      }
      if (seen.has(cur)) {
        // Cycle detected -- assign 0 to all chain members.
        for (const c of chain) depths.set(c, 0);
        return 0;
      }
      seen.add(cur);
      chain.push(cur);
      const row = byIdx.get(cur);
      cur = row ? (row.effective_parent_index ?? null) : null;
    }

    // Reached root (cur === null).
    // chain = [startIdx, ..., root]. root = chain[chain.length-1].
    // root gets depth 0, startIdx gets depth chain.length-1.
    for (let i = 0; i < chain.length; i++) {
      depths.set(chain[i], chain.length - 1 - i);
    }
    return depths.get(startIdx)!;
  };

  for (const row of rows) depthOf(row.row_index);
  return depths;
}

// ── Classification pill (B2b restyle) ────────────────────────────────────────
// Soft per-type opaque fill -- rounded-full lozenge; left-border accent dropped.
// Each entry: paired bg (light/dark) + text (light/dark) Tailwind classes.
// Fully opaque (no /opacity suffix) so sticky-header and row backgrounds don't bleed.

// Exported for reuse by exportReviewCsv (Slice D2) -- the CSV uses the same
// human-readable classification labels the tree renders. No behaviour change.
export const CLS_LABELS: Record<string, string> = {
  preamble:        "Preamble",
  line_item:       "Item",
  note:            "Note",
  spacer:          "Spacer",
  subtotal_marker: "Subtotal",
  header_repeat:   "Header",
};

const CLS_PILL_CLASSES: Record<string, { bg: string; text: string }> = {
  preamble:        { bg: "bg-gray-200 dark:bg-gray-700",       text: "text-gray-700 dark:text-gray-200" },
  line_item:       { bg: "bg-blue-100 dark:bg-blue-900",       text: "text-blue-800 dark:text-blue-200" },
  note:            { bg: "bg-amber-100 dark:bg-amber-900",     text: "text-amber-800 dark:text-amber-200" },
  subtotal_marker: { bg: "bg-emerald-100 dark:bg-emerald-900", text: "text-emerald-800 dark:text-emerald-200" },
  spacer:          { bg: "bg-gray-100 dark:bg-gray-800",       text: "text-gray-500 dark:text-gray-400" },
  header_repeat:   { bg: "bg-slate-100 dark:bg-slate-800",     text: "text-slate-700 dark:text-slate-300" },
};

export function ClassificationPill({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const label = CLS_LABELS[cls] ?? cls;
  const { bg, text } = CLS_PILL_CLASSES[cls] ?? { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300" };
  return (
    <span className={cn("rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap", bg, text)}>
      {label}
    </span>
  );
}

// ── Number formatter (verbatim from B1) ───────────────────────────────────────

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  // Up to 2 decimal places, trailing zeros stripped.
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

// ── Descriptor value resolution ───────────────────────────────────────────────

// Exported for reuse by exportReviewCsv (Slice D2) -- the CSV resolves per-area /
// singleton descriptor values via the exact same walk the tree uses. No behaviour change.
export function resolveDescriptorValue(row: ReviewRow, d: ColumnDescriptor): unknown {
  const top = (row as unknown as Record<string, unknown>)[d.value_field];
  if (top === null || top === undefined) return undefined;
  if (d.value_key === null) return top;
  const dict = top as Record<string, unknown>;
  if (!(d.value_key in dict)) return undefined;
  const mid = dict[d.value_key];
  if (mid === null || mid === undefined) return undefined;
  if (d.rate_subkey === null) return mid;
  return (mid as Record<string, unknown>)[d.rate_subkey];
}

// Absent-vs-zero rule: undefined/null -> blank; 0 -> "0"; numbers -> formatted.
export function renderDescriptorCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return fmtNum(val);
  return String(val);
}
