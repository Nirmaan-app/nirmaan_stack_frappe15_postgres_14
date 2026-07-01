/**
 * SheetDataGrid -- spreadsheet-style read-only preview of raw BoQ sheet data.
 *
 * Slice 3d-i: pure render component. All fetch state owned by SheetSpokePage.
 *
 * Slice 3d-iii annotations (driven by props):
 *   (2a) Area palette  -- 6 fixed Tailwind bg classes, assigned by area_dimensions
 *        index. Column headers tinted by the area of their mapped role. Tint replaces
 *        bg-muted; both are fully opaque (no bleed-through).
 *   (2b) Color-by-area -- column-letter <TableHead> bg-tinted when colEntry.area != null.
 *   (2c) Role badge    -- small badge under the column letter showing ROLE_LABELS[role].
 *        Absent for unmapped columns.
 *   (2d) Dim unmapped  -- data <TableCell>s for columns not in columnRoleMap (or with
 *        empty role) rendered at opacity-50. Mapped columns render normally. Frozen
 *        header rows are exempt from dim (they are header content, not data).
 *   (2e) Freeze header rows -- when headerRow is set, the header band extends UPWARD
 *        from the column-header row through the top header row(s) above it:
 *        [headerRow - (headerRowCount - 1), headerRow]. Those rows become sticky below
 *        the column-letter header row; the first data row (headerRow + 1) is NOT frozen.
 *        Fixed h-10 (40px) on column-letter header cells makes the offset predictable:
 *        top of band (top header) = top-10, column-header row = top-20 (Double).
 *        Frozen cells use solid bg-background (no bleed-through). The gutter cell on
 *        frozen rows is doubly-sticky (left-0 + top-X) at z-[17] -- above frozen data
 *        cells (z-[15]) but below column-letter headers (z-20) and the corner (z-30).
 *
 * Live vs saved asymmetry (by design):
 *   - columnRoleMap is live (updates as user edits Section 3 before Save) -- drives
 *     color, badge, dim.
 *   - headerRow / headerRowCount / areaList come from the last-saved draft.sheet_config
 *     (update only after Save triggers mutate()) -- drives freeze and area-color map.
 */
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ColumnRoleEntry, SheetPreviewRow } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";

// ── Area colour palette (6 entries, wraps with % length) ─────────────────────
// All entries are fully-opaque Tailwind bg classes (no /opacity suffix in light
// mode; dark: variants are also solid) so tinted cells never bleed through.
// Assigned by area_dimensions index (index 0 → first area → AREA_COLORS[0]).
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
  areas.forEach((area, i) => {
    map[area] = AREA_COLORS[i % AREA_COLORS.length];
  });
  return map;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SheetDataGridProps {
  rows: SheetPreviewRow[];
  hasMore: boolean;
  isInitLoading: boolean;
  initError: string | null;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  onLoadMore: () => void;
  columnRoleMap: Record<string, ColumnRoleEntry>;
  /** From last-saved sheet_config. null = no config saved yet → no freeze. */
  headerRow: number | null;
  /** From last-saved sheet_config. Defaults to 1 when no config. */
  headerRowCount: 1 | 2;
  /** From last-saved sheet_config.area_dimensions. Empty → no area tinting. */
  areaList: string[];
  /**
   * Slice 4c: full-screen editor (the grid-only / general-specs read-only fork). When TRUE,
   * the outer wrapper + scroll container relax to flex-1 min-h-0 so the grid fills the
   * expanded full-viewport layout (the page's expanded root is flex flex-col). Default false
   * (embedded layout, back-compat). Layout-only.
   */
  expanded?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sort column letters in Excel worksheet order: A, B, ..., Z, AA, AB, ... */
function sortColLetters(cols: string[]): string[] {
  return [...cols].sort((a, b) =>
    a.length !== b.length ? a.length - b.length : a.localeCompare(b)
  );
}

/** Derive the sorted union of all column letters present across all loaded rows. */
function getColumnSet(rows: SheetPreviewRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const col of Object.keys(row.cells)) seen.add(col);
  }
  return sortColLetters([...seen]);
}

/** Format a cell value as display text. null/undefined → "". Boolean → uppercase string. */
function formatCellValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SheetDataGrid({
  rows,
  hasMore,
  isInitLoading,
  initError,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  columnRoleMap,
  headerRow,
  headerRowCount,
  areaList,
  expanded = false,
}: SheetDataGridProps) {
  // ── Loading state ──────────────────────────────────────────────────────────
  if (isInitLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // ── Error state (inline -- wizard convention, no toast) ───────────────────
  if (initError) {
    return <p className="text-sm text-destructive">{initError}</p>;
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No rows found in this sheet.
      </p>
    );
  }

  // Column header set: union across all loaded rows, Excel-sorted.
  const columns = getColumnSet(rows);

  // Area → color-class map (built from saved area_dimensions list).
  const areaColorMap = buildAreaColorMap(areaList);

  return (
    <div className={cn("space-y-3", expanded && "flex min-h-0 flex-1 flex-col")}>
      {/*
        Scroll container: overflow-auto + max-h bounds BOTH axes so that:
        - Wide sheets scroll horizontally.
        - Long sheets scroll vertically WITHIN the container (not the page).
        The bounded scroll ancestor is required for `sticky top-0` to fire on
        column-letter header cells and for frozen data rows.
        Slice 4c: when expanded, drop the rem-cap and fill the flex-col space instead.
      */}
      <div
        className={cn(
          "overflow-auto rounded-md border border-border",
          expanded ? "min-h-0 flex-1" : "max-h-[calc(100vh-14rem)]",
        )}
      >
        <Table>
          <TableHeader>
            {/*
              Column-letter header row. h-10 is set explicitly on each TableHead so
              the frozen-row top offsets (top-10, top-20) are predictable (40px per row).
            */}
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {/*
                Corner cell: sticky on BOTH axes (top-0 left-0), z-30 sits above
                column-letter headers (z-20) AND row-number gutter cells (z-10).
                bg-muted (solid) covers body content scrolling beneath it.
              */}
              <TableHead className="sticky top-0 left-0 z-30 w-12 min-w-[48px] h-10 text-center text-xs font-medium text-muted-foreground bg-muted border-r border-border">
                #
              </TableHead>

              {columns.map((col) => {
                const colEntry = columnRoleMap[col];
                const colArea = colEntry?.area ?? null;
                const colRole = colEntry?.role ?? "";
                // Area tint: replaces bg-muted with the area's palette color.
                // Both are fully opaque so no bleed-through on scroll.
                const areaBg = colArea && areaColorMap[colArea]
                  ? areaColorMap[colArea]
                  : "bg-muted";
                // Role badge label: shown for mapped columns with a non-empty role.
                const badgeLabel = colRole ? (ROLE_LABELS[colRole] ?? null) : null;

                return (
                  <TableHead
                    key={col}
                    className={cn(
                      "sticky top-0 z-20 min-w-[80px] h-10 text-center text-xs font-semibold",
                      "text-muted-foreground border-r border-border align-middle",
                      areaBg
                    )}
                  >
                    {/*
                      Column letter + optional role badge. Badge uses a semi-transparent
                      overlay (bg-black/10 / bg-white/10) so it works over any area tint.
                      Both wrapped in a flex column so they stack without overflowing h-10.
                    */}
                    <div className="flex flex-col items-center justify-center gap-0.5 leading-none px-1">
                      <span>{col}</span>
                      {badgeLabel && (
                        <span className="text-[9px] leading-tight px-1 rounded bg-black/10 dark:bg-white/15 max-w-full truncate">
                          {badgeLabel}
                        </span>
                      )}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => {
              // Determine if this row is a frozen header row. The band extends UPWARD from the
              // column-header row (headerRow) through the top header row(s) above it:
              // [headerRow - (headerRowCount - 1), headerRow]. The first data row (headerRow + 1)
              // is NOT frozen. headerRow null → nothing frozen.
              const bandTop = headerRow !== null ? headerRow - (headerRowCount - 1) : null;
              const isFrozen =
                headerRow !== null &&
                bandTop !== null &&
                row.row_number >= bandTop &&
                row.row_number <= headerRow;
              // 0-based index within the frozen band (0 = top of band = top header row).
              const frozenIdx = isFrozen && bandTop !== null ? row.row_number - bandTop : -1;

              // Top-offset class for sticky frozen cells.
              // Column-letter header is h-10 (40px). Frozen rows are also h-10 (40px).
              // Band top (top header):    top-10 = 40px (just below the column-letter header).
              // Band bottom (col header): top-20 = 80px (below the column-letter header + first frozen row).
              const frozenTopClass = frozenIdx === 0 ? "top-10" : "top-20";

              return (
                <TableRow key={row.row_number}>
                  {/*
                    Row-number gutter cell.
                    Normal rows: sticky left-0 z-10 bg-background (same as before).
                    Frozen rows: doubly-sticky (left-0 + top-X) at z-[17] so it sits
                    above frozen data cells (z-[15]) but below column-letter headers
                    (z-20). bg-muted differentiates it visually from data cells.
                  */}
                  <TableCell
                    className={cn(
                      "w-12 min-w-[48px] text-center text-xs font-mono text-muted-foreground border-r border-border",
                      isFrozen
                        ? cn("sticky left-0 z-[17] bg-muted h-10", frozenTopClass)
                        : "sticky left-0 z-10 bg-background"
                    )}
                  >
                    {row.row_number}
                  </TableCell>

                  {columns.map((col) => {
                    const text = formatCellValue(row.cells[col]);
                    // A column is "mapped" when it has an entry with a non-empty role.
                    const isMapped =
                      col in columnRoleMap && columnRoleMap[col].role !== "";

                    return (
                      <TableCell
                        key={col}
                        title={text || undefined}
                        className={cn(
                          "max-w-[180px] truncate text-xs border-r border-border",
                          isFrozen
                            ? cn("sticky z-[15] bg-background h-10", frozenTopClass)
                            : !isMapped && "opacity-50"
                        )}
                      >
                        {text}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Load-more control -- shown only when has_more === true */}
      {hasMore && (
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Loading&hellip;
              </>
            ) : (
              "Load next 40 rows"
            )}
          </Button>
          {loadMoreError && (
            <p className="text-xs text-destructive">{loadMoreError}</p>
          )}
        </div>
      )}
    </div>
  );
}
