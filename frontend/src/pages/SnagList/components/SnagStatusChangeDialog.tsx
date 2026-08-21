import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { SnagStatus } from "../types";
import { SNAG_STATUS_BADGE_STYLES } from "../config/snagTable.config";

export interface SnagStatusChangeDialogProps {
  /** The status the user picked. */
  nextStatus: SnagStatus;
  currentStatus: SnagStatus;
  /** The stored remark, pre-filled into the box. */
  remark: string | null;
  isSaving?: boolean;
  onCancel: () => void;
  /**
   * `remark === undefined` means LEAVE THE STORED TEXT ALONE — it is not the same
   * as `""`, which CLEARS it. The caller must preserve that distinction all the way
   * to the wire (ADR-0018).
   */
  onConfirm: (next: SnagStatus, remark: string | undefined) => void;
}

/**
 * The status change, and the remark that rides it (ADR-0018).
 *
 * MOUNTED ONLY WHILE A CHANGE IS PENDING — the caller renders it conditionally, so
 * the draft is seeded by `useState` on mount and there is no effect anywhere that
 * could clobber typing when a background refetch moves `remark`.
 *
 * There is deliberately NO standalone remark editor anywhere in this feature: a
 * remark is written as part of a status change, which is what keeps
 * `status_changed_by` / `status_changed_on` an honest description of the last edit.
 *
 * Three rules the owner settled, none of them free to drift:
 *  - the remark is OPTIONAL (Q3). A required box turns a 40-row closure into 40
 *    typing chores, and what gets typed 40 times is "done".
 *  - it OVERWRITES (Q1a) — the box is pre-filled with the existing text precisely so
 *    the user can see they are editing it, not adding to it.
 *  - "Not Applicable" shows NO box at all (Q2a). This dialog is never opened for it;
 *    the caller writes that status straight through, with no `remark` on the wire.
 */
export const SnagStatusChangeDialog: React.FC<SnagStatusChangeDialogProps> = ({
  nextStatus,
  currentStatus,
  remark,
  isSaving = false,
  onCancel,
  onConfirm,
}) => {
  const stored = remark ?? "";
  const [draft, setDraft] = React.useState(stored);

  const handleConfirm = () => {
    // Untouched -> send NOTHING, so the server leaves the stored text exactly as it
    // is. Sending the same string back would still be a write, and "leave it alone"
    // is a distinct third state from "clear it" (`""`).
    onConfirm(nextStatus, draft === stored ? undefined : draft);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update status</DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-2 pt-1">
              <Badge
                variant="outline"
                className={cn(
                  "whitespace-nowrap font-medium",
                  SNAG_STATUS_BADGE_STYLES[currentStatus]
                )}
              >
                {currentStatus}
              </Badge>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Badge
                variant="outline"
                className={cn(
                  "whitespace-nowrap font-medium",
                  SNAG_STATUS_BADGE_STYLES[nextStatus]
                )}
              >
                {nextStatus}
              </Badge>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-1">
          <label htmlFor="snag-remark" className="text-xs font-medium">
            Remarks <span className="text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="snag-remark"
            autoFocus
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What was done, who is on it, when it will close…"
            className="text-xs"
          />
          {/* The overwrite is the cost of the single-field design — say it plainly
              rather than letting the user discover it. */}
          <p className="text-[11px] text-muted-foreground">
            {stored
              ? "There is one Remarks field, not a thread — saving replaces the text above."
              : "Leave this blank to change only the status."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              `Set to ${nextStatus}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
