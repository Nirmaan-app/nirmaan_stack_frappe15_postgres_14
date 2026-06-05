/**
 * ReviewTree -- nesting-tree renderer for parsed BoQ Review Rows (Slice B1).
 *
 * B1.1b-i: column layer replaced with config-driven columns from column_descriptors
 * (B1.1a backend, feat 58d2ed44). Tree mechanic preserved verbatim from B1.
 *
 * Fixed anchor columns (always shown):
 *   Excel Row  -- source_row_number. Positional; no mapped letter.
 *   Sl.No (X)  -- sl_no_value. X = col letter from the sl_no descriptor, if mapped.
 *   Description (Y) -- description text + tree indent/chevron/pill. Y = col letter
 *                       from the description descriptor, if mapped.
 *
 * Descriptor columns: one per ColumnDescriptor (after FIXED_ROLE_DEDUPE), headed by
 *   "{col} -- {ROLE_LABELS[role]}{ * area}". Descriptors with role "sl_no" or
 *   "description" are excluded (they render as fixed anchors instead).
 *
 * Value resolution per descriptor:
 *   row[value_field]                         -- singleton roles
 *   row[value_field][value_key]              -- qty/amount by area
 *   row[value_field][value_key][rate_subkey] -- rate_*_by_area
 *
 * Absent-vs-zero: undefined/null -> blank cell; 0 -> "0".
 *
 * Classification pill: locked 5-colour left-bordered pill (locked design §2 hex map).
 *   header_repeat not in locked map; uses neutral #94A3B8.
 *
 * B1.1b-ii (next slice): column-subset selector + spacer-hide toggle.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewRow, ColumnDescriptor } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";

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

// ── Classification pill (replaces B1 badge) ───────────────────────────────────
// Locked design §2 colour map. header_repeat is not in the locked map;
// uses neutral #94A3B8 (slate-400 equivalent) so it stays visually subordinate.

const CLS_COLORS: Record<string, string> = {
  preamble:        "#888780",
  line_item:       "#378ADD",
  note:            "#EF9F27",
  subtotal_marker: "#1D9E75",
  spacer:          "#D3D1C7",
  header_repeat:   "#94A3B8", // neutral; not in locked map
};

const CLS_LABELS: Record<string, string> = {
  preamble:        "Preamble",
  line_item:       "Item",
  note:            "Note",
  spacer:          "Spacer",
  subtotal_marker: "Subtotal",
  header_repeat:   "Header",
};

function ClassificationPill({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const color = CLS_COLORS[cls] ?? "#94A3B8";
  const label = CLS_LABELS[cls] ?? cls;
  return (
    <span
      style={{ borderLeft: `3px solid ${color}` }}
      className="rounded-sm py-0.5 px-1.5 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-muted/60 text-foreground"
    >
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

// ── Area colour palette (local mirror of SheetDataGrid -- not exported there) ─

const AREA_COLORS = [
  "bg-blue-100 dark:bg-blue-900",
  "bg-emerald-100 dark:bg-emerald-900",
  "bg-amber-100 dark:bg-amber-900",
  "bg-rose-100 dark:bg-rose-900",
  "bg-violet-100 dark:bg-violet-900",
  "bg-teal-100 dark:bg-teal-900",
] as const;

function buildAreaColorMap(areas: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  areas.forEach((area, i) => { map[area] = AREA_COLORS[i % AREA_COLORS.length]; });
  return map;
}

// ── Descriptor value resolution ───────────────────────────────────────────────

function resolveDescriptorValue(row: ReviewRow, d: ColumnDescriptor): unknown {
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
function renderDescriptorCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return fmtNum(val);
  return String(val);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INDENT_PX = 20;
const VISIBILITY_HOP_CAP = 60; // max ancestor chain length for isVisible check

// Roles shown as fixed anchor columns; excluded from the descriptor-driven layer.
const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

// ── Component ─────────────────────────────────────────────────────────────────

interface ReviewTreeProps {
  rows: ReviewRow[];
  columnDescriptors: ColumnDescriptor[];
}

export function ReviewTree({ rows, columnDescriptors }: ReviewTreeProps) {
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

  // Descriptor processing: dedupe fixed-anchor roles, extract anchor letters, area map.
  const { displayDescriptors, slNoLetter, descriptionLetter, areaColorMap } = useMemo(() => {
    const displayDescriptors = columnDescriptors.filter(d => !FIXED_ROLE_DEDUPE.has(d.role));
    const slNoLetter = columnDescriptors.find(d => d.role === "sl_no")?.col ?? null;
    const descriptionLetter = columnDescriptors.find(d => d.role === "description")?.col ?? null;
    const areas = [
      ...new Set(displayDescriptors.filter(d => d.area !== null).map(d => d.area as string)),
    ];
    return {
      displayDescriptors,
      slNoLetter,
      descriptionLetter,
      areaColorMap: buildAreaColorMap(areas),
    };
  }, [columnDescriptors]);

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
            {/* Excel Row: positional anchor -- source_row_number, no mapped letter */}
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-10 border-r border-border whitespace-nowrap">
              Excel Row
            </th>
            {/* Sl.No: letter from the sl_no descriptor col, if mapped */}
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap">
              {slNoLetter ? `Sl.No (${slNoLetter})` : "Sl.No"}
            </th>
            {/* Description: letter from the description descriptor col, if mapped */}
            <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[280px] whitespace-nowrap">
              {descriptionLetter ? `Description (${descriptionLetter})` : "Description"}
            </th>
            {/* Descriptor-driven columns (no subset filter in this slice) */}
            {displayDescriptors.map(d => {
              const label = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
              const areaCls = d.area ? (areaColorMap[d.area] ?? "") : "";
              return (
                <th
                  key={d.col}
                  className={cn(
                    "px-2 py-2 text-right font-medium text-muted-foreground",
                    "w-28 min-w-[112px] border-l border-border whitespace-nowrap",
                    areaCls,
                  )}
                >
                  {label}
                </th>
              );
            })}
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

            return (
              <tr
                key={row.row_index}
                className={cn(
                  "border-b border-border hover:bg-muted/30 transition-colors",
                  isPreamble && "bg-muted/20",
                )}
              >
                {/* Excel Row */}
                <td className="px-2 py-1.5 text-muted-foreground font-mono align-top w-10 border-r border-border">
                  {row.source_row_number}
                </td>

                {/* Sl.No */}
                <td className="px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border">
                  {row.sl_no_value ?? ""}
                </td>

                {/* Description: indent + toggle + pill + text (tree mechanic verbatim from B1) */}
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

                    <ClassificationPill cls={row.effective_classification} />

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

                {/* Descriptor-driven data columns */}
                {displayDescriptors.map(d => {
                  const val = resolveDescriptorValue(row, d);
                  return (
                    <td
                      key={d.col}
                      className="px-2 py-1.5 text-right align-top border-l border-border tabular-nums"
                    >
                      {renderDescriptorCell(val)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
