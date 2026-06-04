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
}: ParseRunDialogProps) {
  // Track which reviewed sheets are ticked. All ticked by default on open.
  const [tickedSheets, setTickedSheets] = useState<Set<string>>(
    () => new Set(reviewedDrafts.map((d) => d.sheet_name))
  );
  // step 1 = summary + checkboxes; step 2 = warn-before-reparse confirmation.
  const [step, setStep] = useState<1 | 2>(1);

  // Reset to "all ticked, step 1" each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set(reviewedDrafts.map((d) => d.sheet_name)));
      setStep(1);
    }
    // Only reset on open/close transitions -- not on every reviewedDrafts identity change.
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

  // Ordered list of ticked sheet names (preserves reviewedDrafts order).
  const tickedList = reviewedDrafts
    .filter((d) => tickedSheets.has(d.sheet_name))
    .map((d) => d.sheet_name);

  // Ticked sheets that have has_prior_parse=1 (re-parsing them discards prior output).
  const dirtyTicked = reviewedDrafts.filter(
    (d) => tickedSheets.has(d.sheet_name) && d.has_prior_parse === 1
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
        // Block dismiss while in flight so the user sees the parsing state.
        if (!isOpen && !isLoading) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Parse workbook</DialogTitle>
              <DialogDescription>
                Review which sheets to parse. All reviewed sheets are selected by
                default; untick any you want to skip this run.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-1">
              This runs in the background and can take up to ~10 minutes. You
              can keep working; you'll see a summary here when it's done.
            </p>

            {/* Scrollable sheet lists */}
            <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">

              {/* WILL PARSE -- checkboxes */}
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Will parse ({reviewedDrafts.length})
                </p>
                {reviewedDrafts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviewed sheets.</p>
                ) : (
                  <ul className="space-y-2">
                    {reviewedDrafts.map((d) => {
                      const isDirty = d.has_prior_parse === 1;
                      const isTicked = tickedSheets.has(d.sheet_name);
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
                            {isDirty && (
                              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                was parsed -- config changed, will re-parse
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
              {generalSpecsSheetNames.length > 0 && (
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
              {parsedDrafts.length > 0 && (
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
              {pendingSheetNames.length > 0 && (
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
              {skippedSheetNames.length > 0 && (
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
                  `Parse ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* Step 2: warn-before-reparse confirmation */
          <>
            <DialogHeader>
              <DialogTitle>Re-parse previously parsed sheets?</DialogTitle>
              <DialogDescription>
                Re-parsing will discard the existing parse output for{" "}
                {dirtyTicked.length === 1
                  ? `"${dirtyTicked[0].sheet_name.trim() || dirtyTicked[0].sheet_name}"`
                  : `these ${dirtyTicked.length} sheets`}
                . Any edits already made to those parse results will be lost.
              </DialogDescription>
            </DialogHeader>

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
