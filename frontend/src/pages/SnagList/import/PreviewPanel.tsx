/**
 * Snag import wizard -- the parsed preview for ONE sheet.
 *
 * Three jobs, in the order they matter:
 *  1. DISTINCT VALUES, so a typo ("Puller" vs "Piller") is caught BEFORE ingest. Nothing is
 *     auto-merged and no merge is suggested -- we never quietly change what someone typed.
 *     Listed ALPHABETICALLY (not by count) precisely because that is what puts near-
 *     duplicates next to each other.
 *  2. A DUPLICATE WARNING -- a warning, never a block: a defect can genuinely recur.
 *  3. ONE ROW TABLE holding every row of the sheet in Excel order (R2 change 1). A row the
 *     parser skipped is present but UNTICKED, de-emphasised, and SHOWS ITS REASON -- the
 *     reason is what tells someone whether the parser was right to skip it, which is the
 *     whole point of putting it in front of them instead of behind a collapsible.
 *
 * Both summaries (1) and (2) are computed by the server over ACCEPTED rows only, so they are
 * labelled as such -- now that skipped rows share the table, an unlabelled count would read
 * as covering everything on screen.
 *
 * UN-TICKABLE rows (`tickable === false`, i.e. no description) render greyed with a DISABLED
 * checkbox and the reason. This is not cosmetic: the server refuses such a row, so offering a
 * tick it will then refuse is the exact silent-drop shape this screen exists to prevent.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, CopyCheck, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  SKIP_REASON_LABEL,
  type ParsePreviewResponse,
  type ParsedSnagRow,
} from "../types";
import { allRowNums, countTicked, tickableRowNums } from "./importState";

/** Shown on the disabled checkbox of a row that can never become a Snag. */
const UNTICKABLE_TITLE =
  "This row has no description, so it cannot become a snag. Map a different Description column, or fix the row in Excel.";

export interface PreviewPanelProps {
  preview: ParsePreviewResponse | null;
  loading: boolean;
  error: string | null;
  /** False while Description is unmapped (or maps a column not in this sheet). */
  mappingValid: boolean;
  ticked: ReadonlySet<number>;
  onToggleRow: (sourceRow: number) => void;
  onSetRows: (rows: number[], ticked: boolean) => void;
}

export function PreviewPanel({
  preview,
  loading,
  error,
  mappingValid,
  ticked,
  onToggleRow,
  onSetRows,
}: PreviewPanelProps) {
  const rowNums = useMemo(() => allRowNums(preview), [preview]);
  const tickableNums = useMemo(() => tickableRowNums(preview), [preview]);

  if (!mappingValid) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Map a <span className="font-medium text-foreground">Snag Description</span> column to
        see the preview.
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">Preview failed</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (loading && !preview) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading rows…
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-border p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing preview…
      </div>
    );
  }

  const tickedCount = countTicked(ticked, tickableNums);
  const untickableCount = rowNums.length - tickableNums.length;
  const hasSkipped = preview.skipped_count > 0;

  return (
    <div className={cn("space-y-4", loading && "opacity-60 transition-opacity")}>
      {/* 1 -- distinct values (ACCEPTED rows only) ---------------------------- */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-muted/20 px-3 py-2">
        <DistinctValues
          label={preview.distinct_areas.length === 1 ? "area" : "areas"}
          values={preview.distinct_areas}
        />
        <DistinctValues
          label={preview.distinct_categories.length === 1 ? "category" : "categories"}
          values={preview.distinct_categories}
        />
        <span className="text-xs text-muted-foreground">
          Across the {preview.accepted_count}{" "}
          {preview.accepted_count === 1 ? "row" : "rows"} the parser accepted. Check these for
          typos before importing — nothing is merged automatically.
        </span>
      </div>

      {/* 2 -- duplicate warning (ACCEPTED rows only) -------------------------- */}
      {preview.duplicate_count > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <CopyCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-300">
              {preview.duplicate_count} of the {preview.accepted_count} accepted{" "}
              {preview.accepted_count === 1 ? "row" : "rows"} look identical to snags already
              in this project
            </p>
            <p className="text-amber-800/80 dark:text-amber-400/80">
              Marked <span className="font-medium">dup</span> in the table below. This does
              not block the import — a defect can genuinely recur. Untick any you do not
              want. Skipped rows are not checked for duplicates.
            </p>
          </div>
        </div>
      )}

      {/* 3 -- the ONE row table ---------------------------------------------- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              {tickedCount} of {tickableNums.length}{" "}
              {tickableNums.length === 1 ? "row" : "rows"} selected for import
            </h4>
            <p className="text-xs text-muted-foreground">
              {preview.accepted_count} read by the parser
              {hasSkipped && ` · ${preview.skipped_count} skipped`}
              {untickableCount > 0 && ` · ${untickableCount} cannot be imported`}
            </p>
          </div>
          <SelectAllNone
            disabled={tickableNums.length === 0}
            onAll={() => onSetRows(tickableNums, true)}
            onNone={() => onSetRows(rowNums, false)}
          />
        </div>

        {hasSkipped && (
          <p className="text-xs text-muted-foreground">
            Rows the parser skipped are shown greyed with the reason. Tick any it got wrong —
            it will be imported with the rest.
          </p>
        )}

        {rowNums.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
            <span className="text-amber-900 dark:text-amber-300">
              No rows were read from this sheet. Check the column mapping and the header row.
            </span>
          </div>
        ) : (
          <>
            {preview.accepted_count === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
                <span className="text-amber-900 dark:text-amber-300">
                  The parser accepted none of these rows. Check the column mapping and the
                  header row, or tick the rows it got wrong.
                </span>
              </div>
            )}
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-9 px-2 py-2" />
                    <th className="w-14 px-2 py-2 font-medium">Row</th>
                    <th className="w-36 px-2 py-2 font-medium">Area</th>
                    <th className="w-32 px-2 py-2 font-medium">Category</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="w-40 px-2 py-2 font-medium">Remarks</th>
                    {hasSkipped && (
                      <th className="w-40 px-2 py-2 font-medium">Skipped because</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((row) => (
                    <PreviewRow
                      key={row.source_row}
                      row={row}
                      isTicked={ticked.has(row.source_row)}
                      showReasonColumn={hasSkipped}
                      onToggleRow={onToggleRow}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PreviewRow({
  row,
  isTicked,
  showReasonColumn,
  onToggleRow,
}: {
  row: ParsedSnagRow;
  isTicked: boolean;
  showReasonColumn: boolean;
  onToggleRow: (sourceRow: number) => void;
}) {
  const skipped = row.skipped_reason !== null;
  const reasonLabel = row.skipped_reason
    ? SKIP_REASON_LABEL[row.skipped_reason] ?? row.skipped_reason
    : "";

  return (
    <tr
      className={cn(
        "align-top",
        // A skipped row is de-emphasised whether or not it has been re-ticked; re-ticking
        // it gets the blue "coming in anyway" tint on top.
        skipped && "bg-muted/40 text-muted-foreground",
        !row.tickable && "opacity-60",
        row.tickable && !isTicked && "opacity-55",
        row.is_duplicate && !skipped && "bg-amber-50/60 dark:bg-amber-950/20",
        skipped && isTicked && "bg-blue-50 dark:bg-blue-950/30",
      )}
    >
      <td className="px-2 py-1.5">
        <span title={row.tickable ? undefined : UNTICKABLE_TITLE}>
          <Checkbox
            checked={isTicked}
            disabled={!row.tickable}
            aria-label={
              row.tickable
                ? `Include Excel row ${row.source_row}`
                : `Excel row ${row.source_row} cannot be imported — no description`
            }
            onCheckedChange={() => {
              if (row.tickable) onToggleRow(row.source_row);
            }}
          />
        </span>
      </td>
      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
        {row.source_row}
        {row.is_duplicate && (
          <span
            className="ml-1 rounded bg-amber-200 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-200"
            title="Looks identical to a snag already in this project"
          >
            dup
          </span>
        )}
      </td>
      <Clamped text={row.area} className="w-36" />
      <Clamped text={row.category} className="w-32" />
      <DescriptionCell row={row} />
      <Clamped text={row.remark} className="w-40" />
      {showReasonColumn && (
        <td className="w-40 px-2 py-1.5">
          {skipped ? (
            <div className="flex flex-col gap-0.5">
              <Badge
                variant="secondary"
                className="w-fit max-w-full truncate font-normal"
                title={reasonLabel}
              >
                {reasonLabel}
              </Badge>
              {!row.tickable && (
                <span className="text-[11px] leading-tight" title={UNTICKABLE_TITLE}>
                  Cannot be imported
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * A skipped row's MAPPED cells are often all empty (a blank or summary-block row), so the
 * only content it has is `preview_text` -- the first non-empty cell on the row. Falling back
 * to it is what keeps such a row identifiable instead of an anonymous empty line.
 */
function DescriptionCell({ row }: { row: ParsedSnagRow }) {
  const description = row.description?.trim() ?? "";
  if (description) return <Clamped text={description} className="max-w-[24rem]" />;

  const fallback = row.preview_text?.trim() ?? "";
  return (
    <td className="max-w-[24rem] px-2 py-1.5">
      <div className="truncate italic text-muted-foreground" title={fallback || undefined}>
        {fallback || "—"}
      </div>
    </td>
  );
}

function Clamped({ text, className }: { text: string; className?: string }) {
  const value = text?.trim() ?? "";
  return (
    <td className={cn("px-2 py-1.5", className)}>
      <div className="truncate" title={value || undefined}>
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </td>
  );
}

function SelectAllNone({
  disabled,
  onAll,
  onNone,
}: {
  disabled: boolean;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={onAll}
      >
        Select all
      </Button>
      <span className="text-muted-foreground">·</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={onNone}
      >
        Select none
      </Button>
    </div>
  );
}

function DistinctValues({
  label,
  values,
}: {
  label: string;
  values: Array<{ value: string; count: number }>;
}) {
  const [open, setOpen] = useState(false);
  // Alphabetical: near-duplicates land next to each other, which is the entire point.
  const sorted = useMemo(
    () => [...values].sort((a, b) => a.value.localeCompare(b.value)),
    [values],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {values.length} {label}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-auto pr-1">
          {sorted.length === 0 && (
            <li className="text-xs text-muted-foreground">None found.</li>
          )}
          {sorted.map((v) => (
            <li key={v.value}>
              <Badge variant="secondary" className="font-normal">
                <span className="max-w-[16rem] truncate" title={v.value}>
                  {v.value || "(blank)"}
                </span>
                <span className="ml-1.5 tabular-nums text-muted-foreground">{v.count}</span>
              </Badge>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
