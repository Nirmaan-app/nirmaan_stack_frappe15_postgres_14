/**
 * SheetDataGrid -- spreadsheet-style read-only preview of raw BoQ sheet data.
 *
 * Slice 3d-i: SheetDataGrid is now a PURE RENDER COMPONENT. The preview fetch
 * (initial load + load-more) has been lifted to SheetSpokePage, which owns all
 * row state and passes it down as props. The onLoadMore callback replaces the
 * former self-managed handleLoadMore. columnRoleMap is threaded for Slice 3d-iii
 * column annotation (unused in this slice -- no annotation visuals yet).
 *
 * Column header row: Excel column letters (A, B, ...) -- union across all loaded rows,
 * sorted in Excel order (single letters before double letters, then alphabetical).
 * Left gutter: absolute Excel row_number (NOT re-indexed -- row 41 shows "41").
 * Long values: truncated with ellipsis; full value visible on hover via title attr.
 */
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

interface SheetDataGridProps {
  rows: SheetPreviewRow[];
  hasMore: boolean;
  isInitLoading: boolean;
  initError: string | null;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  onLoadMore: () => void;
  /** Column role map -- threaded for Slice 3d-iii annotation (unused in this slice). */
  columnRoleMap: Record<string, ColumnRoleEntry>;
}

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

export function SheetDataGrid({
  rows,
  hasMore,
  isInitLoading,
  initError,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  // columnRoleMap is accepted for Slice 3d-iii but not yet consumed here.
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
  // Recomputed after each load-more append so new columns in later rows appear.
  const columns = getColumnSet(rows);

  return (
    <div className="space-y-3">
      {/*
        Scroll container: overflow-auto + max-h bounds BOTH axes so that:
        - Wide sheets scroll horizontally (overflow-x behavior preserved).
        - Long sheets scroll vertically WITHIN the container (not the page).
        Having a bounded scroll ancestor is required for `sticky top-0` to work
        on the column-letter header cells -- without max-h, the container grows
        to fit content and there is no vertical clip, so sticky never fires.
      */}
      <div className="overflow-auto max-h-[calc(100vh-14rem)] rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {/*
                Corner cell: sticky on BOTH axes (top-0 left-0) with the highest
                z-index (z-30) so it sits on top of column-letter headers (z-20)
                AND row-number gutter cells (z-10) at their intersection.
                bg-muted (solid) covers body content that scrolls beneath it.
              */}
              <TableHead className="sticky top-0 left-0 z-30 w-12 min-w-[48px] text-center text-xs font-medium text-muted-foreground bg-muted border-r border-border">
                #
              </TableHead>
              {/*
                Column-letter headers: sticky top only (z-20, below corner).
                bg-muted (solid) covers body rows that scroll underneath.
                border-r adds the vertical gridlines between columns.
              */}
              {columns.map((col) => (
                <TableHead
                  key={col}
                  className="sticky top-0 z-20 min-w-[80px] text-center text-xs font-semibold text-muted-foreground bg-muted border-r border-border"
                >
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.row_number}>
                {/* Row-number gutter: sticky left only (z-10). bg-background covers scrolled data cells. */}
                <TableCell className="sticky left-0 z-10 w-12 min-w-[48px] text-center text-xs font-mono text-muted-foreground bg-background border-r border-border">
                  {row.row_number}
                </TableCell>
                {columns.map((col) => {
                  const text = formatCellValue(row.cells[col]);
                  return (
                    <TableCell
                      key={col}
                      className="max-w-[180px] truncate text-xs border-r border-border"
                      title={text || undefined}
                    >
                      {text}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
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
          {/* Inline error -- retryable by clicking the button again */}
          {loadMoreError && (
            <p className="text-xs text-destructive">{loadMoreError}</p>
          )}
        </div>
      )}
    </div>
  );
}
