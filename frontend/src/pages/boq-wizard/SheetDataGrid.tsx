/**
 * SheetDataGrid -- spreadsheet-style read-only preview of raw BoQ sheet data.
 *
 * Uses shadcn <Table> (not TanStack -- capped rows, read-only, no sort/filter).
 * Uses useFrappePostCall for all fetches (initial + load-more) so accumulated
 * rows can be managed in local state without mixing SWR state with appended rows.
 *
 * Column header row: Excel column letters (A, B, ...) -- union across all loaded rows,
 * sorted in Excel order (single letters before double letters, then alphabetical).
 * Left gutter: absolute Excel row_number (NOT re-indexed -- row 41 shows "41").
 * Long values: truncated with ellipsis; full value visible on hover via title attr.
 */
import { useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
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
import type { SheetPreviewResponse, SheetPreviewRow } from "./boqTypes";

interface SheetDataGridProps {
  boqName: string;
  /** Verbatim sheet_name as stored in the DB -- passed exactly to the endpoint. */
  sheetName: string;
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

export function SheetDataGrid({ boqName, sheetName }: SheetDataGridProps) {
  // useFrappePostCall is used for ALL fetches (initial + load-more) so that row
  // accumulation is fully controlled by local state without SWR interference.
  // The `call` function is stable (the method string never changes after mount).
  const { call: fetchPreview } = useFrappePostCall<{ message: SheetPreviewResponse }>(
    "nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview"
  );

  const [rows, setRows] = useState<SheetPreviewRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isInitLoading, setIsInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Ref so the useEffect can call the latest fetchPreview without adding it
  // to the dependency array (it is stable -- same hook, same method string).
  const fetchRef = useRef(fetchPreview);
  useEffect(() => { fetchRef.current = fetchPreview; });

  // Initial load -- reruns when boqName or sheetName changes.
  useEffect(() => {
    let cancelled = false;

    setIsInitLoading(true);
    setInitError(null);
    setRows([]);
    setHasMore(false);
    setLoadMoreError(null);

    fetchRef.current({
      boq_name: boqName,
      sheet_name: sheetName,
      start_row: 1,
      end_row: 40,
    })
      .then((result) => {
        if (cancelled) return;
        const preview = result?.message;
        setRows(preview?.rows ?? []);
        setHasMore(preview?.has_more ?? false);
        setIsInitLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInitError(
          "Failed to load sheet preview. Check that the source file is accessible and try again."
        );
        setIsInitLoading(false);
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqName, sheetName]);

  // ── Load-more handler ──────────────────────────────────────────────────────
  // Single-flight: button is disabled while isLoadingMore is true (the disabled
  // state IS the guard -- no queue, no debounce needed).
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    const lastRowNum = rows.length > 0 ? rows[rows.length - 1].row_number : 40;
    const nextStart = lastRowNum + 1;
    const nextEnd = nextStart + 39;

    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const result = await fetchPreview({
        boq_name: boqName,
        sheet_name: sheetName,
        start_row: nextStart,
        end_row: nextEnd,
      });
      const preview = result?.message;
      if (preview) {
        setRows((prev) => [...prev, ...preview.rows]);
        setHasMore(preview.has_more);
      }
    } catch {
      setLoadMoreError("Failed to load more rows. Try again.");
    } finally {
      setIsLoadingMore(false);
    }
  };

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
            onClick={() => void handleLoadMore()}
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
