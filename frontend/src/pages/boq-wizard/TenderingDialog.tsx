/**
 * TenderingDialog -- hub-level "open the pricing editor for a committed sheet" entry
 * (BoQ Phase 5 Slice 3a, the designed entry door per design v1.3 Sec.8.5: a global hub
 * button -> a list of eligible (committed) sheets -> select EXACTLY ONE -> open its
 * pricing editor). This REPLACES the initial 3a per-card "Price" button.
 *
 * Mirrors CommitDialog (the hub-action sheet-picker shell) but SINGLE-SELECT via radios
 * (CommitDialog is a multi-select checklist) and navigate-on-confirm (no in-flight job --
 * the confirm just opens the editor). Router-free: the hub owns navigation via onConfirm.
 * Dismiss convention mirrors ParseRunDialog -- X / Escape / overlay-click all dismiss.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CommittedSheetState } from "./boqTypes";

// "date HH:MM" from a Frappe datetime string -- the wizard's slice(0,16) pattern
// (mirrors CommitDialog / ReviewTree's formatEditAt). No date library, no TZ reparse.
function fmtCommittedAt(at: string | null | undefined): string {
  return typeof at === "string" ? at.slice(0, 16) : "";
}

interface TenderingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The eligible (committed) sheets, keyed by sheet_name VERBATIM (#152), from
   * get_committed_state (the same committedMap the Commit flow + card badges use).
   * Each carries committed_at + commit_version so the user sees which version they price.
   */
  committedState: Map<string, CommittedSheetState>;
  /** Called with the chosen sheet_name (VERBATIM #152) on confirm; the hub navigates. */
  onConfirm: (sheetName: string) => void;
}

export function TenderingDialog({
  open,
  onOpenChange,
  committedState,
  onConfirm,
}: TenderingDialogProps) {
  // Single-select: exactly one committed sheet. null until the user picks one.
  const [selected, setSelected] = useState<string | null>(null);

  // Reset the selection each time the dialog opens.
  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  // The committed sheets, in committed-state order (VERBATIM sheet names).
  const sheets = Array.from(committedState.values());

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // No in-flight job here -- confirm just navigates. X / Escape / overlay dismiss.
        if (!isOpen) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open tendering editor</DialogTitle>
          <DialogDescription>
            Select a committed sheet to price. Exactly one sheet opens in the pricing editor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Committed sheets ({sheets.length})
            </p>
            {sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No committed sheets to price yet.</p>
            ) : (
              <ul className="space-y-2">
                {sheets.map((s) => (
                  <li key={s.sheet_name} className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="tendering-sheet"
                      id={`tendering-rb-${s.sheet_name}`}
                      checked={selected === s.sheet_name}
                      onChange={() => setSelected(s.sheet_name)}
                      className="mt-1 shrink-0"
                    />
                    <label
                      htmlFor={`tendering-rb-${s.sheet_name}`}
                      className="text-sm leading-5 cursor-pointer select-none flex-1 min-w-0"
                    >
                      <span className="block truncate">{s.sheet_name.trim() || s.sheet_name}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        committed {fmtCommittedAt(s.committed_at)} &middot; v{s.commit_version}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onConfirm(selected);
            }}
          >
            Open editor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
