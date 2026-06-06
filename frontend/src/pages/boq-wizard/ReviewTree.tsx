/**
 * ReviewTree -- nesting-tree renderer for parsed BoQ Review Rows (Slice B1).
 *
 * B1.1b-i: column layer replaced with config-driven columns from column_descriptors
 * (B1.1a backend, feat 58d2ed44). Tree mechanic preserved verbatim from B1.
 *
 * B1.1b-fix-B: four display fixes --
 *   FIX 1: Parent column (after Sl.No) -- shows parent's Excel row number; clicking
 *           expands collapsed ancestors, scrolls to the parent row, 1.5s highlight.
 *   FIX 2: Classification pill label no-truncation (aided by FIX 4's layout).
 *   FIX 3: isVisible ancestor-only -- collapsed row stays visible; only descendants hide.
 *   FIX 4: Description cell -- pill on its own line (top), description text below.
 *
 * Fixed anchor columns (always shown):
 *   Excel Row      -- source_row_number. Positional; no mapped letter.
 *   Sl.No (X)      -- sl_no_value. X = col letter from the sl_no descriptor, if mapped.
 *   Parent         -- parent row's source_row_number (Excel row). Derived; no mapped letter.
 *                     Clickable: expands collapsed ancestors + scrolls to parent row.
 *   Classification -- collapse chevron + ClassificationPill. Flat-left (no depth indent).
 *                     Fixed anchor; not in the column-subset selector. (B1.1b-iii)
 *   Description (Y) -- text only; depth-based indent (paddingLeft = depth * INDENT_PX).
 *                      Y = col letter from the description descriptor, if mapped.
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
 * B1.1b-ii: view-filter controls bar above the table --
 *   FEAT A: Column-subset selector -- Popover + Checkbox per displayDescriptor col.
 *     Fixed anchors (Excel Row, Sl.No, Parent, Classification, Description) always render.
 *     visibleCols: Set<string> of col letters initialized to all descriptor cols;
 *     synced via useEffect when displayDescriptors changes (new sheet/descriptors).
 *   FEAT B: Three independent annotation-row visibility toggles -- spacer, note,
 *     subtotal_marker -- each boolean, default true (all shown).
 *     classificationVisible(row) composes with isVisible(row): a row renders only
 *     when BOTH pass. Children of hidden annotation rows render at original depth
 *     because computeDepths pre-runs over all rows and classificationVisible never
 *     touches the collapsed Set. View-filter only -- no data edit.
 *
 * B1.1b-iii: Description cell split into Classification + Description columns --
 *   Classification (new fixed anchor, between Parent and Description): holds the
 *     collapse chevron + ClassificationPill side by side, flat-left (no depth indent).
 *     Not in the column-subset selector.
 *   Description (text-only): holds only the description text + fallback; depth-based
 *     indent (paddingLeft = depth * INDENT_PX) applied here. Chevron + pill removed.
 *   Chevron click/collapse/aria/invisible-on-leaf behavior unchanged verbatim.
 */
import { useMemo, useRef, useEffect, useState, Fragment } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewRow, ColumnDescriptor, AdvisoryFlag } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

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
  flags: AdvisoryFlag[];
}

export function ReviewTree({ rows, columnDescriptors, flags }: ReviewTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // FIX 1: transient highlight for scroll-to-parent affordance (~1.5s flash)
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  // FIX 1: row DOM element refs for scrollIntoView
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());
  // B2a: set of row_indexes whose advisory flag reasons are currently expanded
  const [expandedFlagRows, setExpandedFlagRows] = useState<Set<number>>(new Set());

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

  // B1.1b-ii FEAT A: visible descriptor columns.
  // Lazy-initialized to all descriptor cols on mount; re-synced via useEffect when
  // displayDescriptors changes (e.g., navigating to a different sheet).
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(columnDescriptors.filter(d => !FIXED_ROLE_DEDUPE.has(d.role)).map(d => d.col))
  );
  // B1.1b-ii FEAT B: annotation-row visibility toggles (independent).
  const [showSpacers, setShowSpacers] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showSubtotals, setShowSubtotals] = useState(true);

  const toggleCol = (col: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const toggleCollapse = (rowIdx: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx);
      return next;
    });
  };

  // B2a: toggle click-to-reveal for advisory flag reasons on a row.
  const toggleFlagRow = (rowIdx: number) => {
    setExpandedFlagRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx);
      return next;
    });
  };

  const flagsByRowIdx = useMemo(() => {
    const m = new Map<number, AdvisoryFlag[]>();
    for (const f of flags) { const a = m.get(f.row_index) ?? []; a.push(f); m.set(f.row_index, a); }
    return m;
  }, [flags]);

  // FIX 1: clear highlight after 1.5s
  useEffect(() => {
    if (highlightedIdx === null) return;
    const timer = setTimeout(() => setHighlightedIdx(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightedIdx]);

  // B1.1b-ii: sync visibleCols to all descriptor cols when descriptors change.
  // Fires on mount (harmless redundancy with lazy init) and on prop changes.
  useEffect(() => {
    setVisibleCols(new Set(displayDescriptors.map(d => d.col)));
  }, [displayDescriptors]);

  // FIX 1: expand any collapsed ancestors of targetRowIdx, then scroll + highlight.
  // Uses setTimeout(50ms) to wait for React to commit the expand re-render.
  const revealAndScrollToRow = (targetRowIdx: number) => {
    const toExpand: number[] = [];
    let cur: number | null | undefined = byIdx.get(targetRowIdx)?.effective_parent_index ?? null;
    let hops = 0;
    while (cur !== null && cur !== undefined && cur >= 0 && hops < VISIBILITY_HOP_CAP) {
      if (collapsed.has(cur)) toExpand.push(cur);
      const ancestor = byIdx.get(cur);
      cur = ancestor ? (ancestor.effective_parent_index ?? null) : null;
      hops++;
    }
    if (toExpand.length > 0) {
      setCollapsed(prev => {
        const next = new Set(prev);
        for (const idx of toExpand) next.delete(idx);
        return next;
      });
    }
    setTimeout(() => {
      rowRefs.current.get(targetRowIdx)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setHighlightedIdx(targetRowIdx);
    }, 50);
  };

  // FIX 3: a row is hidden only if an ANCESTOR is collapsed, never itself.
  // Collapsing row R hides R's descendants; R stays visible as the expand affordance.
  //
  // Guards added vs the B1.1b-i version:
  //   cur < 0  -- treats -1 sentinel (pre-fix-A rows have parent_index=0, not -1; this
  //               guard stops any stale -1 value from being looked up in collapsed).
  //   cur === row.row_index  -- self-reference guard; prevents a cyclic row from being
  //               hidden when it is itself collapsed.
  const isVisible = (row: ReviewRow): boolean => {
    let cur: number | null | undefined = row.effective_parent_index;
    let hops = 0;
    while (cur !== null && cur !== undefined && hops < VISIBILITY_HOP_CAP) {
      if (cur < 0) break;                  // -1 sentinel treated as root
      if (cur === row.row_index) break;    // self-reference guard
      if (collapsed.has(cur)) return false;
      const parent = byIdx.get(cur);
      cur = parent ? (parent.effective_parent_index ?? null) : null;
      hops++;
    }
    return true;
  };

  // B1.1b-ii FEAT B: classification-visibility gate.
  // Composes WITH isVisible (collapse): render only when BOTH pass.
  // Never adds rows to `collapsed` -- children of a hidden annotation row render
  // independently at their original computeDepths depth.
  const classificationVisible = (row: ReviewRow): boolean => {
    const cls = row.effective_classification;
    if (cls === "spacer" && !showSpacers) return false;
    if (cls === "note" && !showNotes) return false;
    if (cls === "subtotal_marker" && !showSubtotals) return false;
    return true;
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No rows found for this sheet.</p>
    );
  }

  const hiddenColCount = displayDescriptors.filter(d => !visibleCols.has(d.col)).length;

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* B1.1b-ii: controls bar -- column-subset selector + classification toggles */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-border bg-muted/20 flex-wrap">
        {/* Feature 1: column-subset selector (only when descriptor columns exist) */}
        {displayDescriptors.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-border",
                  "bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors",
                  hiddenColCount > 0 && "border-primary text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Columns
                {hiddenColCount > 0 && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    ({hiddenColCount} hidden)
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto min-w-[200px] p-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Data columns
              </p>
              <div className="space-y-1">
                {displayDescriptors.map(d => {
                  const colLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
                  return (
                    <label
                      key={d.col}
                      htmlFor={`vis-col-${d.col}`}
                      className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Checkbox
                        id={`vis-col-${d.col}`}
                        checked={visibleCols.has(d.col)}
                        onCheckedChange={() => toggleCol(d.col)}
                      />
                      {colLabel}
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {/* Feature 2: three independent annotation-row visibility toggles */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Show:</span>
          <label
            htmlFor="cls-spacers"
            className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            <Checkbox
              id="cls-spacers"
              checked={showSpacers}
              onCheckedChange={(c) => setShowSpacers(c === true)}
            />
            Spacers
          </label>
          <label
            htmlFor="cls-notes"
            className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            <Checkbox
              id="cls-notes"
              checked={showNotes}
              onCheckedChange={(c) => setShowNotes(c === true)}
            />
            Notes
          </label>
          <label
            htmlFor="cls-subtotals"
            className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            <Checkbox
              id="cls-subtotals"
              checked={showSubtotals}
              onCheckedChange={(c) => setShowSubtotals(c === true)}
            />
            Subtotals
          </label>
        </div>
      </div>
      {/* Table scroll area -- max-h adjusted to account for controls bar height */}
      <div className="overflow-auto max-h-[calc(100vh-16rem)]">
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
              {/* Parent (FIX 1): parent row's Excel row number -- derived, no mapped letter */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap">
                Parent
              </th>
              {/* Classification (B1.1b-iii): fixed anchor -- chevron + pill; no mapped letter */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-36 border-r border-border whitespace-nowrap">
                Classification
              </th>
              {/* Description: letter from the description descriptor col, if mapped */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[280px] whitespace-nowrap">
                {descriptionLetter ? `Description (${descriptionLetter})` : "Description"}
              </th>
              {/* Descriptor-driven columns: only rendered when col is in visibleCols */}
              {displayDescriptors.map(d => {
                if (!visibleCols.has(d.col)) return null;
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
              // B1.1b-ii FEAT B: classification-visibility gate (annotation rows only).
              // Children of a filtered row render independently at their original depth.
              if (!classificationVisible(row)) return null;

              const depth = depths.get(row.row_index) ?? 0;
              const hasChildren = hasChildrenSet.has(row.row_index);
              const isCollapsed = collapsed.has(row.row_index);
              const isPreamble = row.effective_classification === "preamble";
              const isLineItem = row.effective_classification === "line_item";

              // FIX 1: resolve parent's Excel row number (null for roots / invalid parent)
              const pIdx = row.effective_parent_index ?? -1;
              const parentExcelRow = pIdx >= 0 ? (byIdx.get(pIdx)?.source_row_number ?? null) : null;

              // B2a: advisory flags for this row
              const rowFlags = flagsByRowIdx.get(row.row_index) ?? [];
              const hasFlags = rowFlags.length > 0;
              const flagsExpanded = expandedFlagRows.has(row.row_index);
              // colSpan for the flag-reasons reveal row: 5 fixed anchors + visible descriptor cols
              const visibleDescriptorCount = displayDescriptors.filter(d => visibleCols.has(d.col)).length;
              const totalCols = 5 + visibleDescriptorCount;

              return (
                // Fragment lets us emit an optional second <tr> (flag-reasons) alongside the data row.
                <Fragment key={row.row_index}>
                  <tr
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.row_index, el);
                      else rowRefs.current.delete(row.row_index);
                    }}
                    className={cn(
                      "border-b border-border hover:bg-muted/30 transition-colors",
                      isPreamble && "bg-muted/20",
                      // FIX 1: transient amber flash when this row is the scroll target
                      highlightedIdx === row.row_index && "bg-amber-100 dark:bg-amber-900/40",
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

                    {/* Parent (FIX 1): clickable "↑ N" link to parent's Excel row; blank for roots */}
                    <td className="px-2 py-1.5 align-top w-16 border-r border-border">
                      {parentExcelRow !== null ? (
                        <button
                          type="button"
                          onClick={() => revealAndScrollToRow(pIdx)}
                          className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          ↑ {parentExcelRow}
                        </button>
                      ) : null}
                    </td>

                    {/* Classification (B1.1b-iii): chevron + pill + optional flag marker.
                        Flag marker (B2a): neutral amber Info icon; click-to-reveal reasons.
                        stopPropagation prevents bubbling to chevron/parent-link handlers. */}
                    <td className="px-2 py-1.5 align-top w-36 border-r border-border">
                      <div className="flex items-start gap-1.5">
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
                        {/* B2a: advisory flag marker -- one unified indicator per flagged row */}
                        {hasFlags && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleFlagRow(row.row_index); }}
                            className={cn(
                              "mt-0.5 ml-auto shrink-0 h-4 w-4 flex items-center justify-center rounded",
                              "transition-colors",
                              flagsExpanded
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-amber-500/70 hover:text-amber-600 dark:text-amber-500/70 dark:hover:text-amber-400",
                            )}
                            aria-label={flagsExpanded ? "Hide advisory notes" : "Show advisory notes"}
                            title={flagsExpanded ? "Hide advisory notes" : "Show advisory notes"}
                          >
                            <Info className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Description (B1.1b-iii): text only; depth indent moved here.
                        paddingLeft = depth * INDENT_PX applied to the content wrapper. */}
                    <td className="px-2 py-1.5 align-top">
                      <div style={{ paddingLeft: `${depth * INDENT_PX}px` }}>
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

                    {/* Descriptor-driven data columns: only rendered when col is in visibleCols */}
                    {displayDescriptors.map(d => {
                      if (!visibleCols.has(d.col)) return null;
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

                  {/* B2a: flag-reasons reveal row -- shown only when marker is clicked */}
                  {hasFlags && flagsExpanded && (
                    <tr className="bg-amber-50/60 dark:bg-amber-950/20">
                      <td
                        colSpan={totalCols}
                        className="px-3 py-2 border-b border-amber-100 dark:border-amber-900/30"
                      >
                        <ul className="space-y-0.5">
                          {rowFlags.map((f, i) => (
                            <li
                              key={i}
                              className="text-xs text-amber-700 dark:text-amber-300 leading-snug"
                            >
                              {f.reason}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
