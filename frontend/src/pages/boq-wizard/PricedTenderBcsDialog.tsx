/**
 * PricedTenderBcsDialog -- the hub's INTERNAL export picker (BCS-EXP-4).
 *
 * A SIBLING of `PricedTenderDialog`, deliberately NOT a prop on it. The two produce different
 * files for different audiences -- one goes to the client, one carries what the job costs us --
 * and a shared component with a boolean would put those two outcomes one mis-set flag apart.
 * The backend keeps them apart the same way (a separate module, so the standing "no BCS in the
 * client export" grep guard stays true); this is that separation carried up to the UI.
 *
 * It calls `export_bcs_writeback.export_priced_workbook_with_bcs`, decodes the returned base64
 * .xlsx, triggers the download, and hands the result up via `onDownloaded` so the hub can
 * surface the per-sheet cost report.
 *
 * ⚠️ IT DOES NOT REFRESH THE STALENESS CHIPS, AND MUST NOT. This export never stamps
 * `last_exported_at` -- that field means "when the CLIENT last got this sheet" -- so there is
 * nothing to re-read and re-reading would only invite someone to make it stamp.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getFrappeError } from "@/utils/frappeErrors";
import type { CommittedSheetState, ExportPricedBcsWorkbookResponse } from "./boqTypes";
import { base64ToBytes, downloadBytes } from "./downloadBlob";

/**
 * May the current user see the internal-export action at all?
 *
 * MIRRORS the server's `_require_bcs_export_access`, which reuses the Pricing Module's
 * `PRICING_ACCESS_SET` (admins + estimation). CONVENIENCE ONLY -- the server is the boundary,
 * and it is gated FIRST, before the BoQ is even resolved.
 *
 * ⚠️ THE "Loading" GUARD IS LOAD-BEARING, exactly as it is on `canAdminOverride`: `useUserData`
 * returns that literal while the Nirmaan Users doc is in flight, and without the guard an
 * entitled user watches the action flash in and vanish.
 *
 * ⚠️ IT IS NARROWER THAN THE SERVER, ON PURPOSE. The server also admits the bare
 * `Nirmaan Estimates Executive` ROLE, which is not visible client-side as a role_profile -- the
 * same limitation `PricingRoute` has and the same resolution: hiding a control from someone the
 * server would admit is a UX bug; showing one to someone it would refuse is a broken promise.
 * Err toward the refusal that never happens.
 */
export function canDownloadBcsExport(role: string, userId: string): boolean {
  if (role === "Loading" || role === "Error") return false;
  return (
    userId === "Administrator" ||
    role === "Nirmaan Admin Profile" ||
    role === "Nirmaan Estimates Executive Profile"
  );
}

/** Every user-facing string, in one place so the two surfaces (dialog + results) cannot drift. */
export const BCS_EXPORT_COPY = {
  menuItem: "Download priced tender with BCS",
  title: "Download priced tender with BCS",
  description:
    "Download the original tender workbook with your rates stamped in, plus the internal cost " +
    "columns, BCS Total Amount and % Margin added at the end of each sheet. This file is for " +
    "internal use -- it shows what the work costs us.",
  // ⚠️ THIS PANEL REVERSES ITS OWN EARLIER MESSAGE. It used to say % Margin was NOT included
  // and tell the user to add it themselves. The column now ships, so the panel's job changed
  // from an apology to a warning: the figures are LIVE, which is a genuine difference from a
  // pasted number and is the first thing someone editing the file needs to know.
  marginTitle: "% Margin is a live formula",
  marginBody:
    "The cost, BCS Total Amount and % Margin columns are Excel formulas, not fixed numbers -- " +
    "edit a cost in the workbook and the total and the margin follow. A margin is left blank " +
    "where the row has no amount to measure against, or where that amount is zero or negative " +
    "(a percentage against a negative amount would read backwards, showing a loss as a profit).",
  noneToExport: "No committed sheets to export.",
  gridOnly: "(no rates to write)",
  bcsOn: "cost tracking on",
  bcsOff: "cost tracking off",
  resultsTitle: "Internal priced tender downloaded",
  failed: "Could not generate the internal workbook. Please try again.",
} as const;

/**
 * The per-sheet badge for the picker. `null` on a grid-only sheet, which already says "no rates
 * to write" -- two absence notes on one row read as a contradiction.
 *
 * ⚠️ A BADGE, NEVER A GATE (owner ruling). A sheet with cost tracking off is still tickable and
 * still exports, just without the block. Do not wire this to `disabled`.
 */
export function bcsBadgeLabel(sheet: CommittedSheetState): string | null {
  if (sheet.sheet_disposition === "grid_only") return null;
  return sheet.bcs_enabled ? BCS_EXPORT_COPY.bcsOn : BCS_EXPORT_COPY.bcsOff;
}

/**
 * The results lines: where each sheet's cost block landed, and for every sheet that got none,
 * WHY. Pure so the wording is testable without spending a download.
 *
 * ⚠️ THE SKIPS ARE REPORTED, NOT SWALLOWED. On a file whose whole point is the cost column, a
 * silently absent block reads as "this sheet costs nothing" rather than "this sheet was never
 * costed" -- the same confusion between an absence and a claim the Total's COUNT guard exists
 * to prevent one level down.
 */
export function summariseCostBlocks(result: ExportPricedBcsWorkbookResponse): {
  written: string[];
  skipped: string[];
} {
  const written = Object.entries(result.cost_blocks ?? {}).map(([sheet, block]) => {
    const cols = Object.values(block.cost_columns ?? {}).join(", ");
    const total = block.total_column ? `, total in ${block.total_column}` : "";
    // A missing margin is NAMED, never left to be noticed. This sheet got a cost block, so
    // it is absent from `cost_skipped` and nothing else in the report would mention it --
    // and a column silently missing from an internal cost file is the exact failure this
    // whole module is built to avoid. The server's own sentence is used verbatim: it knows
    // which of the three reasons applied and the client must not guess.
    const margin = block.margin_column
      ? `, margin in ${block.margin_column}`
      : block.margin_skipped
        ? `, no margin -- ${block.margin_skipped}`
        : "";
    return `${sheet.trim() || sheet}: ${block.rows} costed row${block.rows === 1 ? "" : "s"} in ${cols}${total}${margin}`;
  });
  const skipped = Object.entries(result.cost_skipped ?? {}).map(
    ([sheet, reason]) => `${sheet.trim() || sheet}: ${reason}`,
  );
  return { written, skipped };
}

interface PricedTenderBcsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BOQs docname -- passed VERBATIM to the endpoint. */
  boqName: string;
  /** Current committed-state per sheet, keyed by sheet_name VERBATIM (#152), workbook-ordered. */
  committedState: Map<string, CommittedSheetState>;
  /** Called after the download succeeds, so the hub can show the per-sheet cost report. */
  onDownloaded: (result: ExportPricedBcsWorkbookResponse) => void;
}

export function PricedTenderBcsDialog({
  open,
  onOpenChange,
  boqName,
  committedState,
  onDownloaded,
}: PricedTenderBcsDialogProps) {
  const sheets = useMemo(() => Array.from(committedState.values()), [committedState]);
  // Grid-only sheets carry no rates and no costs -- ticking one would be a no-op, exactly as in
  // the client picker.
  const tickableNames = useMemo(
    () => sheets.filter((s) => s.sheet_disposition !== "grid_only").map((s) => s.sheet_name),
    [sheets],
  );

  const [tickedSheets, setTickedSheets] = useState<Set<string>>(() => new Set(tickableNames));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { call: callExport } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.export_bcs_writeback.export_priced_workbook_with_bcs",
  );

  useEffect(() => {
    if (open) {
      setTickedSheets(new Set(tickableNames));
      setRunning(false);
      setError(null);
    }
    // Only reset on open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleSheet = (sheetName: string) => {
    setTickedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(sheetName)) next.delete(sheetName);
      else next.add(sheetName);
      return next;
    });
  };

  const tickedList = useMemo(
    () => tickableNames.filter((n) => tickedSheets.has(n)),
    [tickableNames, tickedSheets],
  );

  const handleConfirm = async () => {
    if (tickedList.length === 0) return;
    setError(null);
    setRunning(true);
    try {
      // VERBATIM sheet names (#152). The endpoint resolves each sheet's current committed
      // version server-side and never writes the original on S3 (copy-on-write).
      const res = await callExport({ boq_name: boqName, sheet_names: tickedList });
      const result = res.message as ExportPricedBcsWorkbookResponse;
      downloadBytes(base64ToBytes(result.content_base64), result.filename, result.content_type);
      setRunning(false);
      onDownloaded(result);
      onOpenChange(false);
    } catch (e: unknown) {
      setRunning(false);
      setError(`${getFrappeError(e) || BCS_EXPORT_COPY.failed} No file was downloaded.`);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Not dismissible mid-flight: an in-progress export must not be orphaned.
        if (!isOpen && running) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{BCS_EXPORT_COPY.title}</DialogTitle>
          <DialogDescription>{BCS_EXPORT_COPY.description}</DialogDescription>
        </DialogHeader>

        {/* The one thing this file does NOT carry, said before the download rather than after. */}
        <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {BCS_EXPORT_COPY.marginTitle}
            </p>
            <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-400">
              {BCS_EXPORT_COPY.marginBody}
            </p>
          </div>
        </div>

        <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Committed sheets ({sheets.length})
            </p>
            {sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{BCS_EXPORT_COPY.noneToExport}</p>
            ) : (
              <ul className="space-y-2">
                {sheets.map((s) => {
                  const isGridOnly = s.sheet_disposition === "grid_only";
                  const isTicked = tickedSheets.has(s.sheet_name);
                  const badge = bcsBadgeLabel(s);
                  return (
                    <li key={s.sheet_name} className="flex items-start gap-2.5">
                      <Checkbox
                        id={`bcs-cb-${s.sheet_name}`}
                        checked={!isGridOnly && isTicked}
                        onCheckedChange={() => toggleSheet(s.sheet_name)}
                        disabled={running || isGridOnly}
                        className="mt-0.5 shrink-0"
                      />
                      <label
                        htmlFor={`bcs-cb-${s.sheet_name}`}
                        className="text-sm leading-5 cursor-pointer select-none flex-1 min-w-0"
                      >
                        <span className="block truncate">
                          {s.sheet_name.trim() || s.sheet_name}
                          {isGridOnly && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {BCS_EXPORT_COPY.gridOnly}
                            </span>
                          )}
                        </span>
                        {badge && (
                          <span
                            className={
                              s.bcs_enabled
                                ? "mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                : "mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground"
                            }
                          >
                            {badge}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Inline error (wizard convention: text-destructive, never a toast). */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={running || tickedList.length === 0}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              `Download ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
