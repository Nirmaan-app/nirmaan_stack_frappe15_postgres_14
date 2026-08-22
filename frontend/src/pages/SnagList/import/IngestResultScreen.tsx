/**
 * Snag import wizard -- the result screen.
 *
 * FAILURES ARE LOUD. A sheet that failed while its siblings succeeded is the exact case
 * this screen exists for (plan §4, per-sheet failure isolation), so every sheet gets its
 * own line with its own outcome -- never one green toast over the top of a mixed result.
 *
 * REFUSALS ARE LOUD TOO, and for the same reason. `refused_no_description` counts ticked rows
 * the import would not take. A sheet with refusals is `ok: true` and just imports FEWER rows
 * than the footer promised, which is precisely the silent-drop shape R2.1 was about. So the
 * count renders in destructive colour NEXT TO the imported figure, never appended to the muted
 * success line, and it is rolled up into the header summary alongside `failed_count`.
 *
 * ⚠️ ADR-0019: this count is now STRUCTURALLY ALWAYS 0 -- nothing is refused any more, because a
 * human tick is authoritative and a description-less row imports with a fallback. This branch is
 * RETAINED, not deleted, and must stay: it is the instrument that proved R2.1's silent drop
 * fixed, and it is what would make a REGRESSION of that bug visible instead of silent. It
 * already renders only when the count is non-zero (absent and 0 mean the same thing), so on the
 * current backend it simply never fires.
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IngestBatchesResponse, SheetIngestResult } from "../types";

export interface IngestResultScreenProps {
  result: IngestBatchesResponse;
}

/**
 * `refused_no_description` is optional on the wire; absent and 0 mean the same thing -- and
 * post-ADR-0019 that is the only value it takes. Every consumer below is gated on `> 0`.
 */
function refusedCount(r: SheetIngestResult): number {
  return r.ok ? r.refused_no_description ?? 0 : 0;
}

export function IngestResultScreen({ result }: IngestResultScreenProps) {
  const failed = result.failed_count > 0;
  const succeeded = result.results.filter((r) => r.ok).length;
  const refusedTotal = result.results.reduce((sum, r) => sum + refusedCount(r), 0);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-md border p-3",
          failed
            ? "border-destructive/40 bg-destructive/5"
            : "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
        )}
      >
        <p
          className={cn(
            "text-sm font-medium",
            failed ? "text-destructive" : "text-green-800 dark:text-green-300",
          )}
        >
          {failed
            ? `${result.failed_count} of ${result.results.length} sheets failed to import`
            : `Imported ${result.total_imported} ${
                result.total_imported === 1 ? "snag" : "snags"
              }`}
        </p>
        {failed && (
          <p className="mt-1 text-sm text-muted-foreground">
            {succeeded > 0
              ? `${succeeded} imported successfully (${result.total_imported} snags). The failures below imported nothing — fix and re-run just those sheets.`
              : "Nothing was imported."}
          </p>
        )}
        {refusedTotal > 0 && (
          <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {refusedTotal} ticked {refusedTotal === 1 ? "row was" : "rows were"} NOT imported
              — no description. {refusedTotal === 1 ? "It is" : "They are"} listed per sheet
              below. Fix {refusedTotal === 1 ? "it" : "them"} in the workbook and re-import just
              those rows.
            </span>
          </p>
        )}
      </div>

      <ul className="divide-y rounded-md border border-border">
        {result.results.map((r) => (
          <SheetOutcome key={r.sheet_name} result={r} />
        ))}
      </ul>
    </div>
  );
}

function SheetOutcome({ result: r }: { result: SheetIngestResult }) {
  const refused = refusedCount(r);

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      {r.ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{r.sheet_name}</p>
        {r.ok ? (
          <p className="text-sm">
            <span className="text-muted-foreground">
              {r.imported ?? 0} {r.imported === 1 ? "snag" : "snags"} imported
              {r.batch_name ? ` into “${r.batch_name}”` : ""}
            </span>
            {refused > 0 && (
              <>
                <span className="text-muted-foreground"> · </span>
                <span className="font-medium text-destructive">
                  {refused} refused — no description
                </span>
              </>
            )}
          </p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-destructive">
            {r.error || "Import failed for an unknown reason."}
          </p>
        )}
      </div>
    </li>
  );
}
