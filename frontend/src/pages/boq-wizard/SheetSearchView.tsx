/**
 * SheetSearchView -- self-contained, searchable, column-trimmed view of ONE BoQ
 * sheet's raw cell data (Slice 1a).
 *
 * Purpose: the "find the right row in the source sheet" tool. Slice 1b's restructure
 * modal will mount this inside itself to let a user locate a target row (e.g. a
 * prospective parent) far down a large sheet. THIS slice builds + certifies it in
 * isolation via a temporary dev route -- it FINDS and SHOWS rows; it does NOT select
 * or save anything (no "set as parent", no onSelect-that-writes, no save call).
 *
 * Self-contained data (it owns its own fetches):
 *   1. Rows  -- get_sheet_preview via useFrappePostCall. The endpoint hard-caps each
 *      window at 200 rows (_PREVIEW_MAX_ROWS), so on mount this loops windows of 200,
 *      advancing by end_row_requested + 1, until has_more === false -- loading the
 *      ENTIRE sheet up front so search covers every row (not just a 40-row page).
 *   2. Role->letter map -- useFrappeGetDoc("BOQs") -> draft.sheet_config.column_role_map.
 *      Preview cells are keyed by Excel COLUMN LETTER and are role-blind; the role
 *      identity (which letter is Description / Sl.No / Unit / Qty) comes from the saved
 *      column_role_map (same source SheetSpokePage seeds from). Used to trim columns
 *      and to know which letter to search.
 *
 * Column-trim: renders ONLY # (Excel row) + Sl.No + Description + Unit + EVERY Qty
 * column (per-area qty included, each with its Excel letter + area label). Rate and
 * Amount columns are hidden. Degraded mode (no column_role_map): all columns shown,
 * search disabled with an inline note.
 *
 * Scroll/centre/highlight pattern is PORTED from ReviewTree (rowRefs Map + ref
 * callback + scrollIntoView + transient flash + clear timer), reimplemented cleanly
 * here -- NOT imported from ReviewTree. This component does NOT reuse SheetDataGrid
 * (kept byte-for-byte untouched); the trimmed 5-column table + per-row DOM access for
 * scroll/highlight are simplest as a focused table.
 *
 * sheet_name is used VERBATIM everywhere (no trim) -- trailing-space sheet names exist
 * on real workbooks (#152); the backend matches verbatim.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
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
import type {
  BOQsDoc,
  ColumnRoleEntry,
  SheetPreviewResponse,
  SheetPreviewRow,
} from "./boqTypes";

// ── Tuning ──────────────────────────────────────────────────────────────────────
const PREVIEW_WINDOW = 200; // matches backend _PREVIEW_MAX_ROWS (one window per call)
const MAX_WINDOWS = 500; // safety backstop: 500 * 200 = 100k rows before we bail loudly

// Roles whose mapped column is shown in the trimmed view. Rate/Amount/make_model/etc.
// are deliberately excluded. "qty" (per-area) and "qty_total" (single) are BOTH kept.
const QTY_ROLES = new Set(["qty", "qty_total"]);

// ── Types ─────────────────────────────────────────────────────────────────────
interface SheetSearchViewProps {
  boqName: string;
  /** EXACT sheet name (verbatim, no trim) -- matches the DB / backend (#152). */
  sheetName: string;
  /** Optional Excel row number to centre + flash once on first full-loaded render. */
  initialCentreRow?: number;
  /**
   * Non-destructive callback exposed for Slice 1b to consume later. Fires with the
   * current search hit's row (or null when there are no hits). Wired to nothing that
   * saves this slice.
   */
  onCurrentHitChange?: (row: SheetPreviewRow | null) => void;
}

interface DisplayColumn {
  /** Excel column letter (key into row.cells). */
  letter: string;
  /** Human label shown in the header (e.g. "Description", "Qty (Zone A)", or just "C"). */
  label: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sort column letters in Excel worksheet order: A, B, ..., Z, AA, AB, ... */
function sortColLetters(cols: string[]): string[] {
  return [...cols].sort((a, b) =>
    a.length !== b.length ? a.length - b.length : a.localeCompare(b)
  );
}

/** Union of all column letters present across all loaded rows, Excel-sorted. */
function getColumnSet(rows: SheetPreviewRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const col of Object.keys(row.cells)) seen.add(col);
  return sortColLetters([...seen]);
}

/** null/undefined -> ""; boolean -> "TRUE"/"FALSE"; else String(). */
function formatCellValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/**
 * Parse a draft.sheet_config blob into a {col -> {role, area}} map.
 * Mirrors SheetSpokePage's seed: handles object|string config, the current
 * {role, area} entry shape, and the legacy role-only string shape. Returns {} when
 * absent / unparseable (which drives degraded mode).
 */
function parseColumnRoleMap(
  sheetConfig: Record<string, unknown> | string | null | undefined
): Record<string, ColumnRoleEntry> {
  if (!sheetConfig) return {};
  let cfg: Record<string, unknown> | null;
  if (typeof sheetConfig === "string") {
    try {
      cfg = JSON.parse(sheetConfig) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else {
    cfg = sheetConfig;
  }
  const raw = cfg?.column_role_map;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: Record<string, ColumnRoleEntry> = {};
  for (const [col, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "string") {
      out[col] = { role: val, area: null };
    } else if (
      val !== null &&
      typeof val === "object" &&
      "role" in val &&
      typeof (val as { role: unknown }).role === "string"
    ) {
      const v = val as { role: string; area?: string | null };
      out[col] = { role: v.role, area: v.area ?? null };
    }
    // null / malformed entries are silently skipped.
  }
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SheetSearchView({
  boqName,
  sheetName,
  initialCentreRow,
  onCurrentHitChange,
}: SheetSearchViewProps) {
  // ── Full-sheet load (loops 200-row windows until has_more === false) ─────────
  const { call: fetchPreview } = useFrappePostCall<{ message: SheetPreviewResponse }>(
    "nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview"
  );
  const fetchRef = useRef(fetchPreview);
  useEffect(() => {
    fetchRef.current = fetchPreview;
  });

  const [allRows, setAllRows] = useState<SheetPreviewRow[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [isFullLoading, setIsFullLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!boqName || !sheetName) return;
    let cancelled = false;

    setIsFullLoading(true);
    setLoadError(null);
    setAllRows([]);
    setLoadedCount(0);

    void (async () => {
      const acc: SheetPreviewRow[] = [];
      let nextStart = 1;
      try {
        for (let w = 0; w < MAX_WINDOWS; w++) {
          const result = await fetchRef.current({
            boq_name: boqName,
            sheet_name: sheetName, // VERBATIM -- backend matches with no strip (#152)
            start_row: nextStart,
            end_row: nextStart + PREVIEW_WINDOW - 1,
          });
          if (cancelled) return;
          const preview = result?.message;
          if (!preview) break;
          acc.push(...preview.rows);
          // Progressive update so the loading state can report a live row count.
          setAllRows(acc.slice());
          setLoadedCount(acc.length);
          if (!preview.has_more) break;
          // Advance by the (clamped) requested end, NOT the last returned row number:
          // the endpoint skips empty padding rows, so advancing by the request window
          // guarantees forward progress with no overlap and no re-scan.
          nextStart = preview.end_row_requested + 1;
          if (w === MAX_WINDOWS - 1) {
            throw new Error("sheet exceeds the maximum supported size for this view");
          }
        }
        if (!cancelled) setIsFullLoading(false);
      } catch {
        if (!cancelled) {
          setLoadError(
            "Failed to load the full sheet. Check that the source file is accessible and try again."
          );
          setIsFullLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqName, sheetName]);

  // ── Role->letter map (BOQs doc -> draft.sheet_config.column_role_map) ────────
  const { data: boq, isLoading: boqLoading } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqName,
    boqName ? undefined : null
  );
  // VERBATIM match on sheet_name (no trim) -- same rule as the preview fetch.
  const draft = boq?.sheet_drafts?.find((d) => d.sheet_name === sheetName);
  const roleMap = useMemo(
    () => parseColumnRoleMap(draft?.sheet_config),
    [draft?.sheet_config]
  );

  // Trimmed display columns + the Description letter to search on.
  const { displayColumns, descriptionLetter, roleMapAvailable } = useMemo(() => {
    const entries = Object.entries(roleMap);
    const available = entries.length > 0;
    const findLetter = (role: string): string | null =>
      entries.find(([, v]) => v.role === role)?.[0] ?? null;

    const slNo = findLetter("sl_no");
    const desc = findLetter("description");
    const unit = findLetter("unit");
    const qtyCols = sortColLetters(
      entries.filter(([, v]) => QTY_ROLES.has(v.role)).map(([col]) => col)
    ).map((col) => ({ col, area: roleMap[col].area }));

    const cols: DisplayColumn[] = [];
    if (slNo) cols.push({ letter: slNo, label: "Sl.No" });
    if (desc) cols.push({ letter: desc, label: "Description" });
    if (unit) cols.push({ letter: unit, label: "Unit" });
    for (const q of qtyCols) {
      cols.push({ letter: q.col, label: q.area ? `Qty (${q.area})` : "Qty" });
    }
    return { displayColumns: cols, descriptionLetter: desc, roleMapAvailable: available };
  }, [roleMap]);

  // Degraded fallback: no role map -> show every loaded column (Excel order), no labels.
  const allLetters = useMemo(() => getColumnSet(allRows), [allRows]);
  const columns: DisplayColumn[] = roleMapAvailable
    ? displayColumns
    : allLetters.map((l) => ({ letter: l, label: l }));
  const searchEnabled = descriptionLetter !== null;

  // ── Search + hit stepper ─────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [currentHitIdx, setCurrentHitIdx] = useState(0);
  const [flashRow, setFlashRow] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Ordered hit list: row_numbers whose Description cell matches (case-insensitive).
  const hits = useMemo(() => {
    if (!searchEnabled || !descriptionLetter || query.trim() === "") return [];
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    for (const row of allRows) {
      const v = row.cells[descriptionLetter];
      if (v !== null && v !== undefined && String(v).toLowerCase().includes(q)) {
        out.push(row.row_number);
      }
    }
    return out;
  }, [allRows, descriptionLetter, query, searchEnabled]);

  const hitSet = useMemo(() => new Set(hits), [hits]);
  const safeIdx = hits.length > 0 ? Math.min(currentHitIdx, hits.length - 1) : 0;
  const currentHitRow = hits.length > 0 ? hits[safeIdx] : null;

  // Reset to the first hit whenever the hit set changes (new query / new data).
  useEffect(() => {
    setCurrentHitIdx(0);
  }, [hits]);

  // Scroll the current hit into view (centred so it clears the sticky header) + flash.
  useEffect(() => {
    if (currentHitRow === null) return;
    const target = currentHitRow;
    const t = setTimeout(() => {
      rowRefs.current
        .get(target)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashRow(target);
    }, 30);
    return () => clearTimeout(t);
  }, [currentHitIdx, currentHitRow]);

  // Clear the transient flash ~1.2s after it is set.
  useEffect(() => {
    if (flashRow === null) return;
    const t = setTimeout(() => setFlashRow(null), 1200);
    return () => clearTimeout(t);
  }, [flashRow]);

  // initialCentreRow: centre + flash once after the full load completes (idle search).
  const centredRef = useRef(false);
  useEffect(() => {
    if (isFullLoading) return;
    if (centredRef.current) return;
    if (initialCentreRow === undefined || initialCentreRow === null) return;
    if (query.trim() !== "") return;
    centredRef.current = true;
    const t = setTimeout(() => {
      rowRefs.current
        .get(initialCentreRow)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashRow(initialCentreRow);
    }, 50);
    return () => clearTimeout(t);
  }, [isFullLoading, initialCentreRow, query]);

  // onCurrentHitChange callback (via ref so an unstable parent prop never re-fires it).
  const onHitRef = useRef(onCurrentHitChange);
  useEffect(() => {
    onHitRef.current = onCurrentHitChange;
  });
  useEffect(() => {
    if (currentHitRow === null) {
      onHitRef.current?.(null);
      return;
    }
    const row = allRows.find((r) => r.row_number === currentHitRow) ?? null;
    onHitRef.current?.(row);
  }, [currentHitRow, allRows]);

  const stepPrev = () => {
    if (hits.length === 0) return;
    setCurrentHitIdx((i) => (i - 1 + hits.length) % hits.length);
  };
  const stepNext = () => {
    if (hits.length === 0) return;
    setCurrentHitIdx((i) => (i + 1) % hits.length);
  };

  // ── Render: loading / error / empty / table ──────────────────────────────────
  if (isFullLoading || boqLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Loading sheet&hellip; {loadedCount > 0 && `(${loadedCount} rows loaded)`}
        </p>
      </div>
    );
  }

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  if (allRows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No rows found in this sheet.</p>
    );
  }

  const counterText = `${hits.length === 0 ? 0 : safeIdx + 1} of ${hits.length}`;
  const totalCols = columns.length + 1; // +1 for the # gutter

  return (
    <div className="space-y-3">
      {/* ── Search controls bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!searchEnabled}
            placeholder={searchEnabled ? "Search description…" : "Search unavailable"}
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

        {searchEnabled && (
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
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {allRows.length} rows loaded
        </span>
      </div>

      {!searchEnabled && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Description column not mapped for this sheet &mdash; search is unavailable.
          {!roleMapAvailable && " Showing all columns (no column roles configured)."}
        </p>
      )}

      {/* ── Trimmed sheet table ─────────────────────────────────────────────── */}
      <div className="overflow-auto max-h-[calc(100vh-16rem)] rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky top-0 left-0 z-30 w-12 min-w-[48px] h-10 text-center text-xs font-medium text-muted-foreground bg-muted border-r border-border">
                #
              </TableHead>
              {columns.map((col) => (
                <TableHead
                  key={col.letter}
                  className="sticky top-0 z-20 min-w-[120px] h-10 text-left text-xs font-semibold text-muted-foreground bg-muted border-r border-border px-2"
                >
                  {roleMapAvailable ? `${col.label} (${col.letter})` : col.letter}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {allRows.map((row) => {
              const isHit = hitSet.has(row.row_number);
              const isCurrent = row.row_number === currentHitRow;
              const isFlash = row.row_number === flashRow;
              return (
                <TableRow
                  key={row.row_number}
                  ref={(el: HTMLTableRowElement | null) => {
                    if (el) rowRefs.current.set(row.row_number, el);
                    else rowRefs.current.delete(row.row_number);
                  }}
                  className={cn(
                    "border-b border-border",
                    // all matches: soft highlight; current hit: stronger; flash: brightest.
                    isHit && "bg-yellow-100 dark:bg-yellow-900/30",
                    isCurrent && "bg-amber-200 dark:bg-amber-800/50",
                    isFlash && "bg-amber-300 dark:bg-amber-700/70"
                  )}
                >
                  <TableCell className="sticky left-0 z-10 w-12 min-w-[48px] text-center text-xs font-mono text-muted-foreground border-r border-border bg-background">
                    {row.row_number}
                  </TableCell>
                  {columns.map((col) => {
                    const text = formatCellValue(row.cells[col.letter]);
                    return (
                      <TableCell
                        key={col.letter}
                        title={text || undefined}
                        className="max-w-[360px] truncate text-xs border-r border-border px-2"
                      >
                        {text}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {allRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={totalCols}
                  className="text-center text-sm text-muted-foreground py-6"
                >
                  No rows found in this sheet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default SheetSearchView;
