/**
 * CommitDialog -- hub-level "commit eligible sheets" surface (Phase 5 Slice 4b).
 *
 * Mirrors ExportWorkbookDialog (the checklist shell + not-dismissible-mid-flight +
 * inline getFrappeError) and ParseRunDialog (the const [step,setStep] two-step
 * warning). The eligible list comes from get_committable_sheets (the gate);
 * committedState (from get_committed_state, Slice 4a) tells which of those have a
 * current committed record so a re-commit warns first.
 *
 * Deliberate UX: opens with NOTHING ticked (the user must select). On confirm, if
 * any ticked sheet ALSO appears in committedState (a re-commit) -> step 2 names
 * those sheets + their last-committed date/time and requires an explicit
 * destructive confirm; a never-committed-only selection fires directly. commit_boq
 * is @frappe.whitelist(methods=["POST"]); the ordered ticked list is passed as
 * sheet_subset (the backend re-checks the gate before any write).
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
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
import { getFrappeError } from "@/utils/frappeErrors";
import type { CommittableSheet, CommittedSheetState } from "./boqTypes";

// "date HH:MM" from a Frappe datetime string -- the wizard's slice(0,16) pattern
// (mirrors ReviewTree's formatEditAt). No date library, no TZ reparse.
function fmtCommittedAt(at: string | null | undefined): string {
  return typeof at === "string" ? at.slice(0, 16) : "";
}

interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BOQs docname -- passed VERBATIM to commit_boq. */
  boqName: string;
  /** Commit-eligible sheets from get_committable_sheets (each carries disposition). */
  eligibleSheets: CommittableSheet[];
  /** Current committed-state per sheet (Slice 4a), keyed by sheet_name VERBATIM (#152). */
  committedState: Map<string, CommittedSheetState>;
  /** Called after a successful commit so the hub re-fetches (badges + count update). */
  onCommitted: () => void;
}

export function CommitDialog({
  open,
  onOpenChange,
  boqName,
  eligibleSheets,
  committedState,
  onCommitted,
}: CommitDialogProps) {
  // Opens with NOTHING ticked -- deliberate selection required.
  const [tickedSheets, setTickedSheets] = useState<Set<string>>(() => new Set());
  // step 1 = checklist; step 2 = re-commit warning (B-lite).
  const [step, setStep] = useState<1 | 2>(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // commit_boq is @frappe.whitelist(methods=["POST"]); useFrappePostCall .call().
  const { call: callCommitBoq } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.commit_pipeline.commit_boq",
  );

  // Reset to "nothing ticked, step 1, idle" each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set());
      setStep(1);
      setRunning(false);
      setError(null);
    }
    // Only reset on open/close transitions -- not on every eligibleSheets identity change.
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

  // Ordered ticked list (preserves eligibleSheets order -- the Export pattern).
  const tickedList = useMemo(
    () => eligibleSheets.filter((s) => tickedSheets.has(s.sheet_name)).map((s) => s.sheet_name),
    [eligibleSheets, tickedSheets],
  );

  // The ticked sheets that ALSO have a current committed record (the re-commits).
  // VERBATIM key match (#152) -- committedState is keyed by source_sheet_name as stored.
  const recommitSheets = useMemo(
    () => tickedList.filter((name) => committedState.has(name)),
    [tickedList, committedState],
  );

  // Fire the actual commit. Shared by the direct path (step 1, no re-commits) and
  // the "Commit anyway" path (step 2). Ordered ticked list -> sheet_subset.
  const fireCommit = async () => {
    if (tickedList.length === 0) return;
    setError(null);
    setRunning(true);
    try {
      // VERBATIM sheet names (#152). The backend re-checks the gate before any write.
      await callCommitBoq({ boq_name: boqName, sheet_subset: tickedList });
      setRunning(false);
      onCommitted();
      onOpenChange(false);
    } catch (e: unknown) {
      setRunning(false);
      setError(`${getFrappeError(e) || "Commit failed. Please try again."} Nothing was committed.`);
    }
  };

  const handleConfirmClick = () => {
    // Re-commit any already-committed sheet? warn first. Else commit directly.
    if (recommitSheets.length > 0) {
      setStep(2);
    } else {
      void fireCommit();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Not dismissible mid-flight: an in-progress commit must not be orphaned.
        if (!isOpen && running) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Commit sheets</DialogTitle>
              <DialogDescription>
                Commit the selected sheets to the permanent record. Nothing is
                selected by default &mdash; tick the sheets you want to commit.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Eligible sheets ({eligibleSheets.length})
                </p>
                {eligibleSheets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sheets are eligible to commit.</p>
                ) : (
                  <ul className="space-y-2">
                    {eligibleSheets.map((s) => {
                      const isTicked = tickedSheets.has(s.sheet_name);
                      const committed = committedState.get(s.sheet_name);
                      const committedAt = fmtCommittedAt(committed?.committed_at);
                      return (
                        <li key={s.sheet_name} className="flex items-start gap-2.5">
                          <Checkbox
                            id={`commit-cb-${s.sheet_name}`}
                            checked={isTicked}
                            onCheckedChange={() => toggleSheet(s.sheet_name)}
                            disabled={running}
                            className="mt-0.5 shrink-0"
                          />
                          <label
                            htmlFor={`commit-cb-${s.sheet_name}`}
                            className="text-sm leading-5 cursor-pointer select-none flex-1 min-w-0"
                          >
                            <span className="block truncate">
                              {s.sheet_name.trim() || s.sheet_name}
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                ({s.disposition === "general_specs" ? "general specs" : "finalized"})
                              </span>
                            </span>
                            {committed ? (
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                committed {committedAt} &middot; v{committed.commit_version}
                              </span>
                            ) : (
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                not yet committed
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
              <Button
                onClick={handleConfirmClick}
                disabled={running || tickedList.length === 0}
              >
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Committing...
                  </>
                ) : (
                  `Commit ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* Step 2: re-commit warning (B-lite). Names each already-committed sheet
             WITH its last-committed date/time. */
          <>
            <DialogHeader>
              <DialogTitle className="text-destructive">
                {recommitSheets.length === 1
                  ? `Re-commit "${recommitSheets[0].trim() || recommitSheets[0]}"?`
                  : `Re-commit ${recommitSheets.length} already-committed sheets?`}
              </DialogTitle>
              <DialogDescription>
                {recommitSheets.length === 1 ? "This sheet has" : "These sheets have"} already been
                committed. Re-committing supersedes the current committed version &mdash; the prior
                version is frozen (kept as history), not lost.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
              <p className="flex items-start gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {recommitSheets.length === 1
                    ? "Already committed -- re-committing supersedes the current version:"
                    : `${recommitSheets.length} of the selected sheets are already committed and will be superseded:`}
                </span>
              </p>
              <ul className="mt-1.5 space-y-0.5 pl-6 text-sm text-destructive">
                {recommitSheets.map((name) => {
                  const committedAt = fmtCommittedAt(committedState.get(name)?.committed_at);
                  const ver = committedState.get(name)?.commit_version;
                  return (
                    <li key={name}>
                      &middot; {name.trim() || name}
                      {committedAt && (
                        <span className="font-normal">
                          {" "}&mdash; committed {committedAt}
                          {ver !== undefined && ` (v${ver})`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Inline error (a throw during commit lands here too). */}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)} disabled={running}>
                Go back
              </Button>
              <Button variant="destructive" onClick={() => void fireCommit()} disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Committing...
                  </>
                ) : (
                  `Commit ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
