/**
 * Snag import wizard -- the result screen.
 *
 * ⚠️ THIS SCREEN ONLY EVER SHOWS A SUCCESS NOW. A batch is the FILE (owner decision
 * 2026-09-09) and the import is ATOMIC, so a failure never reaches here -- it throws, and
 * the dialog renders `ingestError` on the tabs step instead, with the sheets still on
 * screen to fix. The mixed "2 of 3 sheets failed" state this screen used to render is not
 * merely unhandled, it is no longer REACHABLE: there is no longer a partial success to
 * describe, because a batch that claimed to be the file while missing a sheet's rows was
 * exactly the outcome per-file batching set out to prevent.
 *
 * The per-sheet list SURVIVES that change and earns its place. One batch spanning three
 * sheets still has to answer "what did each sheet contribute" -- a single total silently
 * hides a sheet that mapped to nothing but was ticked, which is the shape of every
 * silent-drop bug this wizard has had (R2.1). A sheet that contributed ZERO cannot occur
 * today (`_sheet_rows` raises rather than return an empty sheet), so the row is rendered
 * loudly if it ever does: it would mean that guard had regressed.
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { IngestBatchResponse, SheetIngestOutcome } from "../types";

export interface IngestResultScreenProps {
  result: IngestBatchResponse;
}

export function IngestResultScreen({ result }: IngestResultScreenProps) {
  const sheets = result.sheets ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-green-300 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/30">
        <p className="text-sm font-medium text-green-800 dark:text-green-300">
          Imported {result.imported} {result.imported === 1 ? "snag" : "snags"} into “
          {result.batch_name}”
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {sheets.length === 1
            ? "One sheet, one batch."
            : `${sheets.length} sheets, combined into one batch.`}{" "}
          It appears as a single tab on the snag list.
        </p>
      </div>

      {sheets.length > 0 && (
        <ul className="divide-y rounded-md border border-border">
          {sheets.map((sheet) => (
            <SheetOutcome key={sheet.sheet_name} sheet={sheet} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SheetOutcome({ sheet }: { sheet: SheetIngestOutcome }) {
  // Unreachable today -- the server refuses a sheet that yields nothing rather than
  // importing it empty. Rendered loudly rather than as a muted "0" so that if the guard
  // ever regresses it reads as the defect it would be, not as a tidy zero.
  const empty = sheet.imported === 0;

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      {empty ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{sheet.sheet_name}</p>
        <p className={empty ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>
          {empty
            ? "contributed no rows — this should not happen; check the sheet before relying on this batch"
            : `${sheet.imported} ${sheet.imported === 1 ? "snag" : "snags"}`}
        </p>
      </div>
    </li>
  );
}
