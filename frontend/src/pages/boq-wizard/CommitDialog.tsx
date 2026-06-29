/**
 * CommitDialog -- hub-level "commit eligible sheets" surface with a PRE-COMMIT
 * issues-review step (commit-preflight slice).
 *
 * FLOW (two steps):
 *   step 1  tick the sheets to commit (opens with NOTHING ticked) -> Continue.
 *   Continue runs commit_preflight (READ-ONLY, spinner) over the ticked sheets and
 *           routes:
 *             - zero issues AND no re-commit  -> commit straight away (no friction);
 *             - otherwise                      -> step 2 (issues review).
 *   step 2  per ticked sheet, grouped: ERRORS (red, BLOCKING -- an errored sheet is
 *           excluded from the commit set and shown blocked) ABOVE WARNINGS (amber,
 *           each individually "Looks OK"-acknowledged via a LOCAL, NON-PERSISTED
 *           checkbox). Clean sheets show a ready tick. The re-commit / supersede
 *           warning is FOLDED IN here (per-sheet sub-label). Commit fires only the
 *           committable (non-errored) subset -> existing onCommitted -> results modal.
 *
 * INVARIANTS
 *   - sheet_name is matched VERBATIM (#152) everywhere (preflight arg, ack key, commit
 *     subset) -- trailing/leading spaces exist; .trim() is DISPLAY-ONLY.
 *   - Acknowledgment is LOCAL useState<Set<string>> keyed by ackKey(sheet, group_key)
 *     and RESET on every open -- NEVER persisted (no dismiss_row_flags call -- this mirrors
 *     ReviewTree's "Looks OK" VISUAL only).
 *   - commit_boq is @frappe.whitelist(methods=["POST"]); the committable subset is passed
 *     as sheet_subset (the backend re-checks the gate before any write).
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
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

// LOCAL ack-Set membership token. VERBATIM sheet_name (#152) + the finding's group_key,
// JSON-encoded so the pair round-trips uniquely regardless of sheet-name contents (a
// trailing space, a colon, etc. can never collide two distinct rows). This token is a
// Set key ONLY -- it is never rendered into a DOM id (those use the row indices).
function ackKey(sheetName: string, groupKey: string): string {
  return JSON.stringify([sheetName, groupKey]);
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
  // Opens with NOTHING ticked -- deliberate selection required.
  const [tickedSheets, setTickedSheets] = useState<Set<string>>(() => new Set());
  // step 1 = checklist; step 2 = issues review.
  const [step, setStep] = useState<1 | 2>(1);
  // The commit_preflight result (set on Continue when step 2 is needed).
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  // LOCAL, NON-PERSISTED warning acknowledgements keyed by ackKey(sheet, group_key).
  const [ackedWarnings, setAckedWarnings] = useState<Set<string>>(() => new Set());
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // commit_preflight (READ-ONLY) + commit_boq (the destructive write) -- both POST.
  const { call: callPreflight } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.commit_validation.commit_preflight",
  );
  const { call: callCommitBoq } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.commit_pipeline.commit_boq",
  );

  // Reset everything each time the dialog opens (ack is NEVER persisted across opens).
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set());
      setStep(1);
      setPreflight(null);
      setAckedWarnings(new Set());
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

  const toggleAck = (key: string) => {
    setAckedWarnings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
  // live gate's order. We render from it directly (a ticked sheet the gate dropped just
  // won't appear -- the commit subset below is sourced from the SAME list, so it is
  // never sent to a write it would fail).
  const sheets: SheetPreflight[] = preflight?.per_sheet ?? [];
  // Committable = no blocking errors. Errored sheets are excluded from the commit set.
  const committableEntries = useMemo(
    () => sheets.filter((s) => s.errors.length === 0),
    [sheets],
  );
  const erroredEntries = useMemo(() => sheets.filter((s) => s.errors.length > 0), [sheets]);
  const committableNames = useMemo(
    () => committableEntries.map((s) => s.sheet_name),
    [committableEntries],
  );

  // Every warning on every COMMITTABLE sheet must be acked before Commit unlocks.
  const requiredAckKeys = useMemo(
    () =>
      committableEntries.flatMap((s) =>
        s.warnings.map((w) => ackKey(s.sheet_name, w.group_key)),
      ),
    [committableEntries],
  );
  const allWarningsAcked = useMemo(
    () => requiredAckKeys.every((k) => ackedWarnings.has(k)),
    [requiredAckKeys, ackedWarnings],
  );

  const commitEnabled = committableNames.length > 0 && allWarningsAcked && !busy;

  // Fire the actual commit with an EXPLICIT subset (the committable, non-errored sheets).
  const fireCommit = async (subset: string[]) => {
    if (subset.length === 0) return;
    setError(null);
    setRunning(true);
    try {
      // VERBATIM sheet names (#152). The backend re-checks the gate before any write.
      const res = await callCommitBoq({ boq_name: boqName, sheet_subset: subset });
      const result = res.message as CommitBoqResponse;
      setRunning(false);
      onCommitted(result);
      onOpenChange(false);
    } catch (e: unknown) {
      // A WHOLE-CALL precondition failure (gate re-check / missing boq / file fetch)
      // throws; per-sheet failures arrive in result.failed, not here.
      setRunning(false);
      setError(`${getFrappeError(e) || "Commit failed. Please try again."} Nothing was committed.`);
    }
  };

  // step 1 "Continue" -> run preflight, then route to commit-now or the issues step.
  const handleContinue = async () => {
    if (tickedList.length === 0) return;
    setError(null);
    setPreflightLoading(true);
    try {
      const res = await callPreflight({ boq_name: boqName, sheet_subset: tickedList });
      const pf = res.message as PreflightResponse;
      setPreflightLoading(false);

      const pfSheets = pf.per_sheet ?? [];
      if (pfSheets.length === 0) {
        // The gate dropped every ticked sheet between selection and Continue.
        setError("None of the selected sheets are still eligible to commit. Refresh and try again.");
        return;
      }

      const committable = pfSheets.filter((s) => s.errors.length === 0);
      const anyError = pfSheets.some((s) => s.errors.length > 0);
      const anyWarning = committable.some((s) => s.warnings.length > 0);
      const anyRecommit = committable.some((s) => committedState.has(s.sheet_name));

      // Zero-issue, first-time commit -> no friction (skip the issues step entirely).
      // A re-commit (even clean) still routes to step 2 so the supersede warning is shown.
      if (!anyError && !anyWarning && !anyRecommit) {
        await fireCommit(committable.map((s) => s.sheet_name));
        return;
      }
      setPreflight(pf);
      setStep(2);
    } catch (e: unknown) {
      setPreflightLoading(false);
      setError(getFrappeError(e) || "Could not check the selected sheets. Please try again.");
    }
  };

  return (
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
                Commit the selected sheets to the permanent record. Nothing is selected by
                default &mdash; tick the sheets you want to commit, then review any issues.
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
              <Button onClick={() => void handleContinue()} disabled={busy || tickedList.length === 0}>
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
                  `Continue (${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""})`
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* step 2: issues review. Errors block; warnings are individually acknowledged. */
          <>
            <DialogHeader>
              <DialogTitle>Review before commit</DialogTitle>
              <DialogDescription>
                Fix errors in review (those sheets won&rsquo;t be committed). Acknowledge each
                warning to continue. Committing is permanent.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1 max-h-[22rem] overflow-y-auto pr-1">
              {sheets.map((s, si) => {
                const isErrored = s.errors.length > 0;
                const committed = committedState.get(s.sheet_name);
                const committedAt = fmtCommittedAt(committed?.committed_at);
                const dispoLabel = s.disposition === "general_specs" ? "general specs" : "finalized";
                return (
                  <div
                    key={s.sheet_name}
                    className={`rounded-md border px-3 py-2.5 ${
                      isErrored
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border bg-muted/30"
                    }`}
                  >
                    {/* Sheet header row: name + disposition hint + status badge. */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {s.sheet_name.trim() || s.sheet_name}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            ({dispoLabel})
                          </span>
                        </p>
                        {/* Re-commit / supersede warning folded in (committable sheets only). */}
                        {!isErrored && committed && (
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>
                              Already committed (v{committed.commit_version}
                              {committedAt && `, ${committedAt}`}) &mdash; committing supersedes it;
                              the prior version is kept as history.
                            </span>
                          </p>
                        )}
                      </div>
                      {isErrored ? (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          <AlertCircle className="h-3 w-3" /> Blocked
                        </span>
                      ) : s.warnings.length > 0 ? (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> {s.warnings.length} warning
                          {s.warnings.length !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      )}
                    </div>

                    {/* ERRORS (red) ABOVE warnings. Blocking -- this sheet is excluded. */}
                    {isErrored && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs font-semibold text-destructive">
                          {s.errors.length} error{s.errors.length !== 1 ? "s" : ""} &mdash; this
                          sheet won&rsquo;t be committed.
                        </p>
                        <ul className="space-y-1.5">
                          {s.errors.map((f) => (
                            <li key={f.group_key} className="text-xs text-destructive">
                              <p>{f.message}</p>
                              {f.what_to_do && (
                                <p className="text-destructive/80">{f.what_to_do}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* WARNINGS (amber) -- each with a LOCAL, NON-PERSISTED "Looks OK" checkbox. */}
                    {!isErrored && s.warnings.length > 0 && (
                      <ul className="mt-2 space-y-2">
                        {s.warnings.map((f, wi) => {
                          const key = ackKey(s.sheet_name, f.group_key);
                          const acked = ackedWarnings.has(key);
                          const domId = `ack-${si}-${wi}`;
                          return (
                            <li
                              key={f.group_key}
                              className={`rounded-md border border-amber-200/60 bg-amber-50/50 px-2.5 py-2 dark:border-amber-900/40 dark:bg-amber-950/15 ${
                                acked ? "opacity-70" : ""
                              }`}
                            >
                              <p className="text-xs text-amber-800 dark:text-amber-200">{f.message}</p>
                              {f.what_to_do && (
                                <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                                  {f.what_to_do}
                                </p>
                              )}
                              <label
                                htmlFor={domId}
                                className="mt-1.5 flex items-center justify-end gap-1.5 cursor-pointer select-none"
                              >
                                <Checkbox
                                  id={domId}
                                  checked={acked}
                                  onCheckedChange={() => toggleAck(key)}
                                  disabled={busy}
                                  className="h-3.5 w-3.5"
                                />
                                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                  {acked && <CheckCircle2 className="h-3 w-3" />}
                                  Looks OK
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Clean sheet -- nothing to acknowledge. */}
                    {!isErrored && s.warnings.length === 0 && (
                      <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                        No issues &mdash; ready to commit.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Excluded-sheet tally (errors must be fixed in review). */}
            {erroredEntries.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  {erroredEntries.length} sheet{erroredEntries.length !== 1 ? "s" : ""} not committed
                  (errors must be fixed in review).
                </span>
              </p>
            )}

            {/* Disabled-reason hint + inline commit error. */}
            {committableNames.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Every selected sheet has errors and can&rsquo;t be committed. Fix them in review.
              </p>
            ) : (
              !allWarningsAcked && (
                <p className="text-xs text-muted-foreground">
                  Acknowledge every warning to enable Commit.
                </p>
              )
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
  );
}
