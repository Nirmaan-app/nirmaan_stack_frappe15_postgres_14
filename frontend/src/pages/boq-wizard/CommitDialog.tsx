/**
 * CommitDialog -- hub-level "commit eligible sheets" surface with a slim,
 * errors-only pre-commit gate (WI-3 simplification).
 *
 * FLOW:
 *   step 1  eligible sheets, ALL PRE-SELECTED by default (untick to leave out) -> Commit.
 *           Commit runs commit_preflight (READ-ONLY, spinner) over the ticked sheets and
 *           routes on ERRORS ONLY (warnings never gate):
 *             - no errored sheets  -> commit the committable subset straight away;
 *             - some errored        -> step 2 (slim errors-only notice) before committing.
 *   step 2  a SLIM notice listing only the errored (blocked) sheets with their message /
 *           what_to_do, a one-liner "{M} sheet(s) will be committed", and a Commit button
 *           firing the committable (non-errored) subset -> onCommitted -> results modal.
 *           NO warning list, NO "Looks OK" acknowledgements, NO supersede notice.
 *
 * INVARIANTS
 *   - sheet_name is matched VERBATIM (#152) everywhere (preflight arg, commit subset) --
 *     trailing/leading spaces exist; .trim() is DISPLAY-ONLY.
 *   - commit_boq is @frappe.whitelist(methods=["POST"]); the committable subset is passed
 *     as sheet_subset (the backend re-checks the gate before any write).
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import type {
  CommitBoqResponse,
  CommittableSheet,
  CommittedSheetState,
  PreflightResponse,
  SheetPreflight,
} from "./boqTypes";

// "date HH:MM" from a Frappe datetime string -- the wizard's slice(0,16) pattern
// (mirrors ReviewTree's formatEditAt). No date library, no TZ reparse.
function fmtCommittedAt(at: string | null | undefined): string {
  return typeof at === "string" ? at.slice(0, 16) : "";
}

interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BOQs docname -- passed VERBATIM to commit_preflight + commit_boq. */
  boqName: string;
  /** Commit-eligible sheets from get_committable_sheets (each carries disposition). */
  eligibleSheets: CommittableSheet[];
  /** Current committed-state per sheet (Slice 4a), keyed by sheet_name VERBATIM (#152). */
  committedState: Map<string, CommittedSheetState>;
  /**
   * Called after commit_boq RESOLVES with the {committed, failed} envelope. The hub
   * re-fetches (badges + count) AND opens the acknowledge-only results modal. A
   * resolved envelope can still carry failed[] entries (a whole-call precondition
   * failure throws -> the catch below). VERBATIM sheet names (#152).
   */
  onCommitted: (result: CommitBoqResponse) => void;
}

export function CommitDialog({
  open,
  onOpenChange,
  boqName,
  eligibleSheets,
  committedState,
  onCommitted,
}: CommitDialogProps) {
  // Opens with ALL eligible sheets pre-selected -- untick to leave any out.
  const [tickedSheets, setTickedSheets] = useState<Set<string>>(
    () => new Set(eligibleSheets.map((s) => s.sheet_name)),
  );
  // step 1 = checklist; step 2 = slim errors-only notice.
  const [step, setStep] = useState<1 | 2>(1);
  // The commit_preflight result (set on Commit when some sheets have blocking errors).
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // C0 / ADR-0011: when commit_boq reports it would orphan downstream pricing, hold the message
  // + the subset to retry so the user can explicitly confirm (re-submit with confirm_orphan).
  const [orphanPrompt, setOrphanPrompt] = useState<{ message: string; subset: string[] } | null>(null);

  // commit_preflight (READ-ONLY) + commit_boq (the destructive write) -- both POST.
  const { call: callPreflight } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.commit_validation.commit_preflight",
  );
  const { call: callCommitBoq } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.commit_pipeline.commit_boq",
  );

  // Reset everything each time the dialog opens (all eligible sheets pre-selected).
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set(eligibleSheets.map((s) => s.sheet_name)));
      setStep(1);
      setPreflight(null);
      setPreflightLoading(false);
      setRunning(false);
      setError(null);
    }
    // Only reset on open/close transitions -- not on every eligibleSheets identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = preflightLoading || running;

  const toggleSheet = (sheetName: string) => {
    setTickedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(sheetName)) next.delete(sheetName);
      else next.add(sheetName);
      return next;
    });
  };

  // Ordered ticked list (preserves eligibleSheets order). VERBATIM names (#152).
  const tickedList = useMemo(
    () => eligibleSheets.filter((s) => tickedSheets.has(s.sheet_name)).map((s) => s.sheet_name),
    [eligibleSheets, tickedSheets],
  );

  // ── step-2 derivations from the preflight envelope ──────────────────────────────
  // per_sheet was returned for EXACTLY the ticked-and-still-committable sheets, in the
  // live gate's order. Committable = no blocking errors; errored sheets are excluded from
  // the commit set (the commit subset is sourced from the SAME list, so it is never sent
  // to a write it would fail). WARNINGS never gate -- they are not surfaced here.
  const sheets: SheetPreflight[] = preflight?.per_sheet ?? [];
  const erroredEntries = useMemo(() => sheets.filter((s) => s.errors.length > 0), [sheets]);
  const committableNames = useMemo(
    () => sheets.filter((s) => s.errors.length === 0).map((s) => s.sheet_name),
    [sheets],
  );

  const commitEnabled = committableNames.length > 0 && !busy;

  // Fire the actual commit with an EXPLICIT subset (the committable, non-errored sheets).
  const fireCommit = async (subset: string[], confirmOrphan = false) => {
    if (subset.length === 0) return;
    setError(null);
    setOrphanPrompt(null);
    setRunning(true);
    try {
      // VERBATIM sheet names (#152). The backend re-checks the gate before any write.
      const res = await callCommitBoq({
        boq_name: boqName,
        sheet_subset: subset,
        confirm_orphan: confirmOrphan, // C0: acknowledged orphaning of downstream pricing
      });
      const result = res.message as CommitBoqResponse;
      setRunning(false);
      onCommitted(result);
      onOpenChange(false);
    } catch (e: unknown) {
      // A WHOLE-CALL precondition failure (gate re-check / missing boq / file fetch) throws;
      // per-sheet failures arrive in result.failed, not here.
      setRunning(false);
      const msg = getFrappeError(e) || "";
      if (msg.includes("BOQ_DOWNSTREAM_ORPHAN")) {
        // C0 / ADR-0011: re-committing would orphan downstream pricing. Surface an explicit
        // confirm (strip the marker prefix), then retry with confirm_orphan=true.
        setOrphanPrompt({ message: msg.replace(/^.*?BOQ_DOWNSTREAM_ORPHAN:\s*/, ""), subset });
      } else {
        setError(`${msg || "Commit failed. Please try again."} Nothing was committed.`);
      }
    }
  };

  // step 1 "Commit" -> run preflight, then route on ERRORS ONLY: no blocked sheets ->
  // commit straight away; otherwise -> step 2 (slim errors-only notice). Warnings never gate.
  const handleCommitClick = async () => {
    if (tickedList.length === 0) return;
    setError(null);
    setPreflightLoading(true);
    try {
      const res = await callPreflight({ boq_name: boqName, sheet_subset: tickedList });
      const pf = res.message as PreflightResponse;
      setPreflightLoading(false);

      const pfSheets = pf.per_sheet ?? [];
      if (pfSheets.length === 0) {
        // The gate dropped every ticked sheet between selection and Commit.
        setError("None of the selected sheets are still eligible to commit. Refresh and try again.");
        return;
      }

      const committable = pfSheets.filter((s) => s.errors.length === 0);
      const errored = pfSheets.filter((s) => s.errors.length > 0);

      // No blocking errors -> commit the committable subset straight away (no friction).
      if (errored.length === 0) {
        await fireCommit(committable.map((s) => s.sheet_name));
        return;
      }
      // Some sheets are blocked -> show the slim errors-only notice before committing.
      setPreflight(pf);
      setStep(2);
    } catch (e: unknown) {
      setPreflightLoading(false);
      setError(getFrappeError(e) || "Could not check the selected sheets. Please try again.");
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Not dismissible mid-flight: an in-progress preflight/commit must not be orphaned.
        if (!isOpen && busy) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Commit sheets</DialogTitle>
              <DialogDescription>
                All eligible sheets are selected by default; untick any you want to leave out.
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
                            disabled={busy}
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
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void handleCommitClick()} disabled={busy || tickedList.length === 0}>
                {preflightLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Committing...
                  </>
                ) : (
                  `Commit (${tickedList.length})`
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* step 2: SLIM errors-only notice. Only blocked sheets are listed; the rest commit. */
          <>
            <DialogHeader>
              <DialogTitle>Some sheets can&rsquo;t be committed</DialogTitle>
              <DialogDescription>
                The sheets below have errors and won&rsquo;t be committed. Fix them in review.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2.5 py-1 max-h-[22rem] overflow-y-auto pr-1">
              {erroredEntries.map((s) => {
                const dispoLabel = s.disposition === "general_specs" ? "general specs" : "finalized";
                return (
                  <div
                    key={s.sheet_name}
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {s.sheet_name.trim() || s.sheet_name}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          ({dispoLabel})
                        </span>
                      </p>
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                        <AlertCircle className="h-3 w-3" /> Blocked
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {s.errors.map((f) => (
                        <li key={f.group_key} className="text-xs text-destructive">
                          <p>{f.message}</p>
                          {f.what_to_do && <p className="text-destructive/80">{f.what_to_do}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            {/* One-liner: how many sheets will still be committed. */}
            {committableNames.length > 0 ? (
              <p className="text-sm text-foreground">
                {committableNames.length} sheet{committableNames.length !== 1 ? "s" : ""} will be
                committed.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Every selected sheet has errors and can&rsquo;t be committed. Fix them in review.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>
                Go back
              </Button>
              <Button onClick={() => void fireCommit(committableNames)} disabled={!commitEnabled}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Committing...
                  </>
                ) : (
                  `Commit ${committableNames.length} sheet${committableNames.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* C0 / ADR-0011: explicit confirm when a re-commit would orphan downstream pricing. The
        backend threw BOQ_DOWNSTREAM_ORPHAN; on confirm we retry with confirm_orphan=true. */}
    <AlertDialog
      open={!!orphanPrompt}
      onOpenChange={(isOpen) => { if (!isOpen && !running) setOrphanPrompt(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            This will orphan priced cells
          </AlertDialogTitle>
          <AlertDialogDescription>{orphanPrompt?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={running}
            onClick={() => { if (orphanPrompt) void fireCommit(orphanPrompt.subset, true); }}
          >
            Re-commit anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
