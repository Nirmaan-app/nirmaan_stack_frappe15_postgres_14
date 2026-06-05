/**
 * ReviewTree -- nesting-tree renderer for parsed BoQ Review Rows (Slice B1).
 *
 * Reads effective_parent_index from each row (as returned by get_review_rows /
 * resolve_effective -- -1 sentinel already translated to null on the backend).
 * Computes per-row depth by walking the effective_parent_index chain.
 *
 * Cycle protection: the depth-walk uses a visited set per chain; rows involved
 * in a cycle receive depth 0 (silent cap for B1 -- B2 surfaces cycle flags).
 *
 * Expand/collapse: click a row that has children to toggle its subtree.
 * Visibility check walks up the parent chain; capped at 60 hops for safety.
 *
 * B1 scope (read-only):
 *   - Shows source_row_number, classification badge, description, unit,
 *     qty_total, rate_combined/rate_supply fallback, amount_total.
 *   - No flag overlays, no row-detail panel, no integrity indicators (B2).
 *   - No editing affordances (C).
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewRow } from "./boqTypes";

// ── Depth computation ─────────────────────────────────────────────────────────
//
// Builds a Map<row_index, depth> for all rows. Root rows (effective_parent_index
// null) get depth 0. Each child is one deeper than its parent.
//
// Algorithm: iterative chain-walk per row, memoized. For each row we walk up
// through effective_parent_index until we hit null (root), a pre-computed depth,
// or a cycle (visited set). Cycle members receive depth 0.
//
// Time: O(n) amortised -- each node is visited once via memoisation.

function computeDepths(rows: ReviewRow[]): Map<number, number> {
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

// ── Classification badge ──────────────────────────────────────────────────────

const CLS_BADGE: Record<string, { label: string; className: string }> = {
  preamble:        { label: "Preamble",  className: "bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900" },
  line_item:       { label: "Item",      className: "bg-blue-600 text-white dark:bg-blue-400 dark:text-blue-950" },
  note:            { label: "Note",      className: "bg-muted text-muted-foreground border border-border" },
  spacer:          { label: "Spacer",    className: "bg-muted text-muted-foreground border border-border" },
  subtotal_marker: { label: "Subtotal",  className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  header_repeat:   { label: "Header",    className: "bg-muted text-muted-foreground border border-border" },
};

function ClassificationBadge({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const entry = CLS_BADGE[cls] ?? { label: cls, className: "bg-muted text-muted-foreground border border-border" };
  return (
    <span className={cn(
      "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap",
      entry.className,
    )}>
      {entry.label}
    </span>
  );
}

// ── Number formatter ──────────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  // Up to 2 decimal places, trailing zeros stripped.
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INDENT_PX = 20;
const VISIBILITY_HOP_CAP = 60; // max ancestor chain length for isVisible check

// ── Component ─────────────────────────────────────────────────────────────────

interface ReviewTreeProps {
  rows: ReviewRow[];
}

export function ReviewTree({ rows }: ReviewTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const { depths, hasChildrenSet, byIdx } = useMemo(() => {
    const depths = computeDepths(rows);
    const hasChildrenSet = new Set<number>();
    const byIdx = new Map<number, ReviewRow>(rows.map(r => [r.row_index, r]));
    for (const row of rows) {
      const p = row.effective_parent_index;
      if (p !== null && p !== undefined) hasChildrenSet.add(p);
    }
    return { depths, hasChildrenSet, byIdx };
  }, [rows]);

  const toggleCollapse = (rowIdx: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx);
      return next;
    });
  };

  // A row is visible if none of its effective ancestors are in the collapsed set.
  // Cap at VISIBILITY_HOP_CAP to prevent infinite loops on malformed chains.
  const isVisible = (row: ReviewRow): boolean => {
    let cur = row.effective_parent_index;
    let hops = 0;
    while (cur !== null && cur !== undefined && hops < VISIBILITY_HOP_CAP) {
      if (collapsed.has(cur)) return false;
      const parent = byIdx.get(cur);
      cur = parent ? (parent.effective_parent_index ?? null) : null;
      hops++;
    }
    return true;
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No rows found for this sheet.</p>
    );
  }

  return (
    <div className="overflow-auto max-h-[calc(100vh-14rem)] rounded-md border border-border">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-muted/50 sticky top-0 z-10 border-b border-border">
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-10 border-r border-border">
              #
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[280px]">
              Description
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-l border-border">
              Unit
            </th>
            <th className="px-2 py-2 text-right font-medium text-muted-foreground w-20 border-l border-border">
              Qty
            </th>
            <th className="px-2 py-2 text-right font-medium text-muted-foreground w-24 border-l border-border">
              Rate
            </th>
            <th className="px-2 py-2 text-right font-medium text-muted-foreground w-24 border-l border-border">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            if (!isVisible(row)) return null;

            const depth = depths.get(row.row_index) ?? 0;
            const hasChildren = hasChildrenSet.has(row.row_index);
            const isCollapsed = collapsed.has(row.row_index);
            const isPreamble = row.effective_classification === "preamble";
            const isLineItem = row.effective_classification === "line_item";

            // Rate: prefer rate_combined, fall back to rate_supply.
            const rateVal = row.rate_combined ?? row.rate_supply;

            return (
              <tr
                key={row.row_index}
                className={cn(
                  "border-b border-border hover:bg-muted/30 transition-colors",
                  isPreamble && "bg-muted/20",
                )}
              >
                {/* Source row number from Excel */}
                <td className="px-2 py-1.5 text-muted-foreground font-mono align-top w-10 border-r border-border">
                  {row.source_row_number}
                </td>

                {/* Description: indent + toggle + badge + text */}
                <td className="px-2 py-1.5 align-top">
                  <div
                    className="flex items-start gap-1.5"
                    style={{ paddingLeft: `${depth * INDENT_PX}px` }}
                  >
                    {/* Expand/collapse toggle -- invisible (not hidden) on leaf rows
                        so the layout stays stable and descriptions align. */}
                    <button
                      type="button"
                      className={cn(
                        "mt-0.5 shrink-0 h-4 w-4 flex items-center justify-center rounded",
                        "text-muted-foreground hover:text-foreground transition-colors",
                        !hasChildren && "invisible pointer-events-none",
                      )}
                      onClick={() => { if (hasChildren) toggleCollapse(row.row_index); }}
                      aria-label={isCollapsed ? "Expand" : "Collapse"}
                      tabIndex={hasChildren ? 0 : -1}
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-3 w-3" />
                        : <ChevronDown className="h-3 w-3" />}
                    </button>

                    <ClassificationBadge cls={row.effective_classification} />

                    <span className={cn(
                      "leading-snug break-words min-w-0",
                      isPreamble && "font-medium text-foreground",
                      isLineItem && "text-foreground",
                      !isPreamble && !isLineItem && "text-muted-foreground italic text-[11px]",
                    )}>
                      {row.description || (
                        <span className="not-italic text-muted-foreground">(no description)</span>
                      )}
                    </span>
                  </div>
                </td>

                {/* Unit */}
                <td className="px-2 py-1.5 text-muted-foreground align-top w-16 border-l border-border">
                  {row.unit ?? ""}
                </td>

                {/* Qty -- only shown for line_items */}
                <td className="px-2 py-1.5 text-right align-top w-20 border-l border-border">
                  {isLineItem ? fmtNum(row.qty_total) : ""}
                </td>

                {/* Rate (combined preferred, supply fallback) -- line_items only */}
                <td className="px-2 py-1.5 text-right align-top w-24 border-l border-border">
                  {isLineItem ? fmtNum(rateVal) : ""}
                </td>

                {/* Amount -- line_items only */}
                <td className="px-2 py-1.5 text-right align-top w-24 border-l border-border">
                  {isLineItem ? fmtNum(row.amount_total) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
