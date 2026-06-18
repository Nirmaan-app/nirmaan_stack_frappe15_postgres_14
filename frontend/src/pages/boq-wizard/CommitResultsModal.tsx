/**
 * CommitResultsModal -- the acknowledge-only commit-results surface (Phase 5 Slice 5
 * frontend). Mirrors the hub's parse-completion modal: a single OK action, open
 * driven from result state, escape also dismisses. HUB-SCOPED -- not app-global.
 *
 * commit_boq (Slice 5 backend) no longer throws on a per-sheet failure -- it returns
 * {committed:[...], failed:[...]} and a MIXED outcome (some of each) is normal. This
 * modal enumerates, SEPARATELY, the sheets that committed (with their new version)
 * and the sheets that failed (with their reason), so the user explicitly acknowledges
 * the outcome rather than the dialog silently closing.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { CommitBoqResponse } from "./boqTypes";

interface CommitResultsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The commit_boq envelope; null until a commit has resolved (modal stays closed). */
  result: CommitBoqResponse | null;
}

export function CommitResultsModal({
  open,
  onOpenChange,
  result,
}: CommitResultsModalProps) {
  // Render nothing without a result (the modal only opens once a commit resolves).
  if (!result) return null;

  const committed = result.committed ?? [];
  const failed = result.failed ?? [];
  const nC = committed.length;
  const nF = failed.length;

  // Summary reads correctly for all three outcomes.
  let summary: string;
  if (nF === 0) {
    summary = `Committed ${nC} sheet${nC !== 1 ? "s" : ""}.`;
  } else if (nC === 0) {
    summary = `Commit failed for ${nF} sheet${nF !== 1 ? "s" : ""}.`;
  } else {
    summary = `Committed ${nC} sheet${nC !== 1 ? "s" : ""}; ${nF} failed.`;
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        // Acknowledge-only: nothing is in flight, so escape / OK both just dismiss.
        if (!isOpen) onOpenChange(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Commit results</AlertDialogTitle>
        </AlertDialogHeader>

        <p className="text-sm font-medium text-foreground">{summary}</p>

        <div className="space-y-3 py-1 max-h-72 overflow-y-auto pr-1">
          {/* COMMITTED -- success styling, shown only when non-empty. */}
          {committed.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Committed ({committed.length})
              </p>
              <ul className="space-y-1">
                {committed.map((c) => (
                  <li
                    key={c.sheet_name}
                    className="flex items-start gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      {/* Display-trimmed; the modal never re-sends these names. */}
                      {c.sheet_name.trim() || c.sheet_name} &mdash; committed v{c.commit_version}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* FAILED -- destructive styling, shown only when non-empty. */}
          {failed.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Failed ({failed.length})
              </p>
              <ul className="space-y-1">
                {failed.map((f) => (
                  <li
                    key={f.sheet_name}
                    className="flex items-start gap-1.5 text-sm text-destructive"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      {f.sheet_name.trim() || f.sheet_name} &mdash; {f.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
