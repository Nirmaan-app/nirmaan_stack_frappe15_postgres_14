/**
 * ReviewRowParentPicker -- tree-aware "pick a parent" surface for the RestructureModal.
 *
 * Replaces SheetSearchView inside the restructure flow. SheetSearchView re-fetched the
 * ENTIRE raw sheet (get_sheet_preview_full -- an S3 read + workbook open, ~30s on a
 * 1001-row sheet) plus the BOQs doc on EVERY mount (every picker open / option toggle /
 * per-child switch) and blocked with a spinner. But the RestructureModal already holds
 * the full in-memory review rows (its `rows` prop) -- which carry everything the picker
 * needs AND reflect the CURRENT effective tree (more correct than static raw cells). So
 * this picker renders straight from `rows`: zero fetch, instant, tree-aware.
 *
 * It emits row_index DIRECTLY via onSelect (no Excel-row_number -> row_index resolution,
 * no no-match guard -- every rendered candidate is a real review row).
 *
 * Cycle hint (client-side, advisory): the caller passes excludeSubtreeRoots (the row(s)
 * whose subtree must not become their own descendant's parent). This picker greys out
 * each such root PLUS all of its descendants (walked via effective_parent_index) so the
 * user can't pick a cycle-invalid candidate. The backend batch cycle-guard remains the
 * authoritative correctness boundary -- this is only a UX hint.
 *
 * Scroll/centre/highlight is PORTED from SheetSearchView (rowRefs Map + scrollIntoView +
 * transient flash) but keyed by row_index (not Excel row_number). Search uses the shared
 * fuzzyDescriptionMatchSet for MEMBERSHIP; hits are re-emitted in document order so
 * prev/next steps top-to-bottom.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeDepths, ClassificationPill } from "./reviewRender";
import { fuzzyDescriptionMatchSet } from "./boqDescriptionSearch";
import type { ReviewRow } from "./boqTypes";

interface ReviewRowParentPickerProps {
  /** All review rows for the sheet (the modal's in-memory `rows` -- effective tree). */
  rows: ReviewRow[];
  /**
   * Subtree roots to grey out (self + all descendants). The client cycle hint: a row
   * cannot be reparented under itself or any of its own descendants. The backend batch
   * cycle-guard is authoritative; this is advisory UX only.
   */
  excludeSubtreeRoots: number[];
  /** The currently-picked row_index (persistent blue tint), or null. */
  selectedRowIndex: number | null;
  /** Fires with the clicked row's row_index (never a disabled row). */
  onSelect: (rowIndex: number) => void;
  /** Optional row_index to centre + flash once on first render (idle search). */
  initialCentreRowIndex?: number;
}

/** Up to 2 dp, trailing zeros stripped (local copy of reviewRender's private fmtNum). */
function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

export function ReviewRowParentPicker({
  rows,
  excludeSubtreeRoots,
  selectedRowIndex,
  onSelect,
  initialCentreRowIndex,
}: ReviewRowParentPickerProps) {
  // Document order = row_index order (get_review_rows is already row_index-ordered; we
  // sort defensively so the fuzzy stepper always walks top-to-bottom).
  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => a.row_index - b.row_index),
    [rows],
  );

  // Skip pure blank spacers (spacer classification + no description) to cut noise.
  const visibleRows = useMemo(
    () =>
      orderedRows.filter((r) => {
        const isSpacer =
          r.effective_classification === "spacer" || r.classification === "spacer";
        const hasDesc = !!(r.description && r.description.trim());
        return !(isSpacer && !hasDesc);
      }),
    [orderedRows],
  );

  // Effective-tree depth per row_index (indent) -- the SAME walk the tree uses.
  const depths = useMemo(() => computeDepths(rows), [rows]);

  // ── Cycle hint: disabled set = union of each excluded root + all its descendants ──
  // Walk children via effective_parent_index with a visited-guard (cycle-safe).
  const disabledSet = useMemo(() => {
    const childrenMap = new Map<number, number[]>();
    for (const r of rows) {
      const p = r.effective_parent_index;
      if (p === null || p === undefined) continue;
      const bucket = childrenMap.get(p);
      if (bucket) bucket.push(r.row_index);
      else childrenMap.set(p, [r.row_index]);
    }
    const disabled = new Set<number>();
    const stack = [...excludeSubtreeRoots];
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      if (disabled.has(idx)) continue; // visited-guard -> cycle-safe
      disabled.add(idx);
      const kids = childrenMap.get(idx);
      if (kids) for (const k of kids) if (!disabled.has(k)) stack.push(k);
    }
    return disabled;
  }, [rows, excludeSubtreeRoots]);

  // ── Search + hit stepper (ported from SheetSearchView, keyed by row_index) ────────
  const [query, setQuery] = useState("");
  const [currentHitIdx, setCurrentHitIdx] = useState(0);
  const [flashRow, setFlashRow] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Ordered hit list: row_indexes whose description FUZZY-matches (token AND, partial,
  // min length 2 -- shared matcher). Fuzzy decides MEMBERSHIP; we re-emit in document
  // order so prev/next steps top-to-bottom.
  const hits = useMemo(() => {
    if (query.trim().length < 2) return [];
    const matched = fuzzyDescriptionMatchSet(visibleRows, query, (r) => r.description ?? "");
    return visibleRows.filter((r) => matched.has(r)).map((r) => r.row_index);
  }, [visibleRows, query]);

  const hitSet = useMemo(() => new Set(hits), [hits]);
  const safeIdx = hits.length > 0 ? Math.min(currentHitIdx, hits.length - 1) : 0;
  const currentHitRowIndex = hits.length > 0 ? hits[safeIdx] : null;

  // Reset to the first hit whenever the hit set changes (new query / new data).
  useEffect(() => {
    setCurrentHitIdx(0);
  }, [hits]);

  // Scroll the current hit into view (centred so it clears the sticky header) + flash.
  useEffect(() => {
    if (currentHitRowIndex === null) return;
    const target = currentHitRowIndex;
    const t = setTimeout(() => {
      rowRefs.current.get(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashRow(target);
    }, 30);
    return () => clearTimeout(t);
  }, [currentHitIdx, currentHitRowIndex]);

  // Clear the transient flash ~1.2s after it is set.
  useEffect(() => {
    if (flashRow === null) return;
    const t = setTimeout(() => setFlashRow(null), 1200);
    return () => clearTimeout(t);
  }, [flashRow]);

  // initialCentreRowIndex: centre + flash once on first render (only while idle search).
  const centredRef = useRef(false);
  useEffect(() => {
    if (centredRef.current) return;
    if (initialCentreRowIndex === undefined || initialCentreRowIndex === null) return;
    if (query.trim() !== "") return;
    centredRef.current = true;
    const t = setTimeout(() => {
      rowRefs.current
        .get(initialCentreRowIndex)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashRow(initialCentreRowIndex);
    }, 50);
    return () => clearTimeout(t);
  }, [initialCentreRowIndex, query]);

  const stepPrev = () => {
    if (hits.length === 0) return;
    setCurrentHitIdx((i) => (i - 1 + hits.length) % hits.length);
  };
  const stepNext = () => {
    if (hits.length === 0) return;
    setCurrentHitIdx((i) => (i + 1) % hits.length);
  };

  const counterText = `${hits.length === 0 ? 0 : safeIdx + 1} of ${hits.length}`;

  if (visibleRows.length === 0) {
    return <p className="text-sm text-muted-foreground">No rows to choose from.</p>;
  }

  return (
    <div className="space-y-3">
      {/* ── Search controls bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search description…"
            className="h-9 w-72 pl-8 pr-8"
            aria-label="Search description"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="min-w-[64px] text-sm tabular-nums text-muted-foreground">
            {counterText}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={hits.length === 0}
            onClick={stepPrev}
            aria-label="Previous match"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={hits.length === 0}
            onClick={stepNext}
            aria-label="Next match"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          {visibleRows.length} rows
        </span>
      </div>

      {/* ── Review-row table (document order, tree indent) ──────────────────── */}
      <div className="overflow-auto max-h-[50vh] rounded-md border border-border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky top-0 left-0 z-30 w-12 min-w-[48px] h-10 text-center text-xs font-medium text-muted-foreground bg-muted border-r border-border">
                #
              </TableHead>
              <TableHead className="sticky top-0 z-20 w-24 h-10 text-left text-xs font-semibold text-muted-foreground bg-muted border-r border-border px-2">
                Class
              </TableHead>
              <TableHead className="sticky top-0 z-20 h-10 text-left text-xs font-semibold text-muted-foreground bg-muted border-r border-border px-2">
                Description
              </TableHead>
              <TableHead className="sticky top-0 z-20 w-20 h-10 text-left text-xs font-semibold text-muted-foreground bg-muted border-r border-border px-2">
                Unit
              </TableHead>
              <TableHead className="sticky top-0 z-20 w-28 h-10 text-right text-xs font-semibold text-muted-foreground bg-muted px-2">
                Qty
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {visibleRows.map((row) => {
              const isHit = hitSet.has(row.row_index);
              const isCurrent = row.row_index === currentHitRowIndex;
              const isFlash = row.row_index === flashRow;
              const isSelected =
                selectedRowIndex !== null && row.row_index === selectedRowIndex;
              const isDisabled = disabledSet.has(row.row_index);
              const depth = depths.get(row.row_index) ?? 0;
              const areas = row.qty_by_area ? Object.entries(row.qty_by_area) : [];
              const hasTotal = row.qty_total !== null && row.qty_total !== undefined;
              return (
                <TableRow
                  key={row.row_index}
                  ref={(el: HTMLTableRowElement | null) => {
                    if (el) rowRefs.current.set(row.row_index, el);
                    else rowRefs.current.delete(row.row_index);
                  }}
                  onClick={isDisabled ? undefined : () => onSelect(row.row_index)}
                  className={cn(
                    "border-b border-border",
                    isDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-pointer hover:bg-muted/50",
                    // all matches: soft highlight; current hit: stronger; flash: brightest.
                    isHit && "bg-yellow-100 dark:bg-yellow-900/30",
                    isCurrent && "bg-amber-200 dark:bg-amber-800/50",
                    isFlash && "bg-amber-300 dark:bg-amber-700/70",
                    // Persistent "selected" tint: an inset blue ring (box-shadow), so it never
                    // collides with the yellow/amber background tiers above.
                    isSelected && "ring-2 ring-inset ring-blue-500 dark:ring-blue-400",
                  )}
                >
                  <TableCell className="sticky left-0 z-10 w-12 min-w-[48px] text-center text-xs font-mono text-muted-foreground border-r border-border bg-background">
                    {row.source_row_number}
                  </TableCell>
                  <TableCell className="w-24 border-r border-border px-2 align-top">
                    <ClassificationPill cls={row.effective_classification} />
                  </TableCell>
                  <TableCell
                    className="text-xs border-r border-border whitespace-normal break-words align-top"
                    style={{ paddingLeft: 8 + depth * 16, paddingRight: 8 }}
                    title={row.description ?? undefined}
                  >
                    {row.description || (
                      <span className="italic text-muted-foreground">(no description)</span>
                    )}
                  </TableCell>
                  <TableCell className="w-20 text-xs border-r border-border px-2 align-top whitespace-normal break-words">
                    {row.unit ?? ""}
                  </TableCell>
                  <TableCell className="w-28 text-xs px-2 align-top text-right">
                    {(hasTotal || areas.length > 0) && (
                      <div className="flex flex-col items-end gap-0.5">
                        {hasTotal && (
                          <span className="tabular-nums">{fmtNum(row.qty_total)}</span>
                        )}
                        {areas.map(([area, v]) => (
                          <span
                            key={area}
                            className="text-[10px] text-muted-foreground tabular-nums"
                          >
                            {area}: {fmtNum(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default ReviewRowParentPicker;
