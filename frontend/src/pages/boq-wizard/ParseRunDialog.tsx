import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { BoQSheetDraft } from "./boqTypes";
import { formatDate } from "@/utils/FormatDate";

interface ParseRunDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the exact sheet_names list to pass to run_parse. */
  onConfirm: (sheetNames: string[]) => void;
  /** All "Reviewed" effective-status sheets -- each gets a checkbox. */
  reviewedDrafts: BoQSheetDraft[];
  /** All "Parsed" effective-status sheets -- shown as read-only "Already parsed". */
  parsedDrafts: BoQSheetDraft[];
  /** Sheet names with Pending or Parse-failed status -- informational only. */
  pendingSheetNames: string[];
  /** Sheet names with Skip or Hidden status -- informational only. */
  skippedSheetNames: string[];
  /** General-specs sheet names -- shown as "preamble only" informational row. */
  generalSpecsSheetNames: string[];
  /** True while the parse job is in flight (button shows spinner, nav blocked). */
  isLoading: boolean;
  /**
   * Dialog mode (Force Re-parse slice). "parse" (default) = the normal parse path:
   * tickable source is `reviewedDrafts`, the four informational lists show, no
   * force_reparse. "reparse" = the Force Re-parse path: tickable source is
   * `reparseDrafts` (already-parsed sheets the backend admits under force_reparse --
   * Parsed / Parsed Check Done / dirty-Reviewed), informational lists hidden, copy
   * + warning re-targeted. The parent derives force_reparse from its own mode state;
   * onConfirm's signature is unchanged.
   */
  mode?: "parse" | "reparse";
  /**
   * Re-parse-eligible drafts -- the tickable source in "reparse" mode. Each carries
   * has_prior_parse === 1, so the destructive warning always fires on confirm. Ignored
   * in "parse" mode.
   */
  reparseDrafts?: BoQSheetDraft[];
  /**
   * Per-card pre-filter (Force Re-parse slice). When set in "reparse" mode, the
   * tickable list is narrowed to this ONE sheet (pre-ticked). null/undefined = the
   * full re-parse picker (global entry point). VERBATIM sheet_name (#152).
   */
  restrictToSheetName?: string | null;
}

export function ParseRunDialog({
  open,
  onClose,
  onConfirm,
  reviewedDrafts,
  parsedDrafts,
  pendingSheetNames,
  skippedSheetNames,
  generalSpecsSheetNames,
  isLoading,
  mode = "parse",
  reparseDrafts = [],
  restrictToSheetName = null,
}: ParseRunDialogProps) {
  const isReparse = mode === "reparse";

  // The tickable source. Parse mode = Reviewed drafts (the existing behaviour).
  // Reparse mode = the re-parse-eligible drafts, optionally narrowed to one sheet
  // (per-card entry point). Computed before state so the seed effect reads it.
  const tickableDrafts = isReparse
    ? restrictToSheetName
      ? reparseDrafts.filter((d) => d.sheet_name === restrictToSheetName)
      : reparseDrafts
    : reviewedDrafts;

  // Track which sheets are ticked. All ticked by default on open.
  const [tickedSheets, setTickedSheets] = useState<Set<string>>(
    () => new Set(tickableDrafts.map((d) => d.sheet_name))
  );
  // step 1 = summary + checkboxes; step 2 = warn-before-reparse confirmation.
  const [step, setStep] = useState<1 | 2>(1);

  // Reset to "all ticked, step 1" each time the dialog opens. Reads the current
  // tickableDrafts (mode/restrict are set by the parent before open flips true).
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set(tickableDrafts.map((d) => d.sheet_name)));
      setStep(1);
    }
    // Only reset on open/close transitions -- not on every drafts identity change.
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

  // Ordered list of ticked sheet names (preserves tickableDrafts order).
  const tickedList = tickableDrafts
    .filter((d) => tickedSheets.has(d.sheet_name))
    .map((d) => d.sheet_name);

  // Ticked sheets that have has_prior_parse=1 (re-parsing them discards prior output).
  // In reparse mode every tickable sheet qualifies; in parse mode only dirty-Reviewed.
  const dirtyTicked = tickableDrafts.filter(
    (d) => tickedSheets.has(d.sheet_name) && d.has_prior_parse === 1
  );

  // Of the discarded sheets, those a human hand-reviewed and marked Checked -- the
  // loudest loss (a completed review is thrown away). Drives the step-2 callout.
  const checkedDoneTicked = dirtyTicked.filter(
    (d) => d.wizard_status === "Parsed Check Done"
  );

  const handleParseClick = () => {
    if (dirtyTicked.length > 0) {
      setStep(2);
    } else {
      onConfirm(tickedList);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Dismiss is always allowed -- closing does not cancel the server parse job.
        // The parse keeps running; the hub's Parse button stays in Parsing... state
        // (driven by parseInFlight in BoqHubPage). Cancel button stays disabled while
        // loading because "Cancel" implies aborting the job, which is not supported.
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>{isReparse ? "Re-parse sheets" : "Parse workbook"}</DialogTitle>
              <DialogDescription>
                {isReparse
                  ? "Re-parse rebuilds these already-parsed sheets from the source file. All eligible sheets are selected by default; untick any you want to leave as-is."
                  : "Review which sheets to parse. All reviewed sheets are selected by default; untick any you want to skip this run."}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-1">
              This runs in the background and can take up to ~10 minutes. You
              can keep working; you'll see a summary here when it's done.
            </p>

            {/* Scrollable sheet lists */}
            <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">

              {/* WILL PARSE / WILL RE-PARSE -- checkboxes */}
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {isReparse ? "Will re-parse" : "Will parse"} ({tickableDrafts.length})
                </p>
                {tickableDrafts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {isReparse ? "No sheets to re-parse." : "No reviewed sheets."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {tickableDrafts.map((d) => {
                      const isDirty = d.has_prior_parse === 1;
                      const isTicked = tickedSheets.has(d.sheet_name);
                      // Per-row note: in reparse mode name what is discarded by status;
                      // in parse mode flag only dirty-Reviewed sheets (the existing note).
                      const note = isReparse
                        ? d.wizard_status === "Parsed Check Done"
                          ? "checked -- re-parsing discards the completed review"
                          : d.wizard_status === "Parsed"
                          ? "parsed -- current output will be discarded"
                          : "was parsed -- config changed, will re-parse"
                        : isDirty
                        ? "was parsed -- config changed, will re-parse"
                        : null;
                      return (
                        <li key={d.sheet_name} className="flex items-start gap-2.5">
                          <Checkbox
                            id={`parse-cb-${d.sheet_name}`}
                            checked={isTicked}
                            onCheckedChange={() => toggleSheet(d.sheet_name)}
                            disabled={isLoading}
                            className="mt-0.5 shrink-0"
                          />
                          <label
                            htmlFor={`parse-cb-${d.sheet_name}`}
                            className={cn(
                              "text-sm leading-5 cursor-pointer select-none flex-1 min-w-0",
                              !isTicked && "text-muted-foreground line-through"
                            )}
                          >
                            <span className="block truncate">
                              {d.sheet_name.trim() || d.sheet_name}
                            </span>
                            {note && (
                              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {note}
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* General specs -- informational (no checkbox, preamble-only note) */}
              {mode === "parse" && generalSpecsSheetNames.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    General specs -- preamble only ({generalSpecsSheetNames.length})
                  </p>
                  <ul className="space-y-1">
                    {generalSpecsSheetNames.map((name) => (
                      <li key={name} className="text-sm text-muted-foreground pl-1">
                        {name.trim() || name}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ALREADY PARSED -- read-only with last_parsed_at */}
              {mode === "parse" && parsedDrafts.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Already parsed ({parsedDrafts.length})
                  </p>
                  <ul className="space-y-1">
                    {parsedDrafts.map((d) => (
                      <li key={d.sheet_name} className="text-sm text-muted-foreground pl-1">
                        {d.sheet_name.trim() || d.sheet_name}
                        {d.last_parsed_at && (
                          <span className="ml-1.5 text-xs">
                            &middot; {formatDate(d.last_parsed_at)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* PENDING -- read-only informational */}
              {mode === "parse" && pendingSheetNames.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Pending / not configured ({pendingSheetNames.length})
                  </p>
                  <ul className="space-y-1">
                    {pendingSheetNames.map((name) => (
                      <li key={name} className="text-sm text-muted-foreground pl-1">
                        {name.trim() || name}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* SKIPPED -- read-only informational */}
              {mode === "parse" && skippedSheetNames.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Skipped / hidden ({skippedSheetNames.length})
                  </p>
                  <ul className="space-y-1">
                    {skippedSheetNames.map((name) => (
                      <li key={name} className="text-sm text-muted-foreground pl-1">
                        {name.trim() || name}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button
                onClick={handleParseClick}
                disabled={isLoading || tickedList.length === 0}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  `${isReparse ? "Re-parse" : "Parse"} ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* Step 2: warn-before-reparse confirmation (destructive safety surface) */
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">
                {dirtyTicked.length === 1
                  ? `Discard all work on "${dirtyTicked[0].sheet_name.trim() || dirtyTicked[0].sheet_name}"?`
                  : `Discard all work on these ${dirtyTicked.length} sheets?`}
              </DialogTitle>
              <DialogDescription>
                Re-parsing rebuilds {dirtyTicked.length === 1 ? "this sheet" : "these sheets"} from the
                source file. This permanently discards the current parsed output{" "}
                <span className="font-semibold text-foreground">and every review-screen change</span>{" "}
                on {dirtyTicked.length === 1 ? "it" : "them"} &mdash; edited values and text, remarks,
                classification changes, and any parenting / restructure moves. This cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {/* LOUDEST callout: hand-reviewed + Checked sheets lose a completed review. */}
            {checkedDoneTicked.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
                <p className="flex items-start gap-1.5 text-sm font-semibold text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {checkedDoneTicked.length === 1
                      ? `"${checkedDoneTicked[0].sheet_name.trim() || checkedDoneTicked[0].sheet_name}" was hand-reviewed and marked Checked.`
                      : `${checkedDoneTicked.length} sheets were hand-reviewed and marked Checked.`}{" "}
                    Re-parsing throws away that completed review entirely.
                  </span>
                </p>
                {checkedDoneTicked.length > 1 && (
                  <ul className="mt-1.5 space-y-0.5 pl-6 text-sm text-destructive">
                    {checkedDoneTicked.map((d) => (
                      <li key={d.sheet_name}>&middot; {d.sheet_name.trim() || d.sheet_name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {dirtyTicked.length > 1 && (
              <ul className="py-1 space-y-1 text-sm text-muted-foreground">
                {dirtyTicked.map((d) => (
                  <li key={d.sheet_name} className="pl-2">
                    &middot; {d.sheet_name.trim() || d.sheet_name}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-1">
              This runs in the background and can take up to ~10 minutes. You
              can keep working; you'll see a summary here when it's done.
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                disabled={isLoading}
              >
                Go back
              </Button>
              <Button
                variant="destructive"
                onClick={() => onConfirm(tickedList)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  "Re-parse anyway"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
