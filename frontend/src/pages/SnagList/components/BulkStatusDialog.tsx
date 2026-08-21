import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { SNAG_STATUSES, SnagStatus } from "../types";

export interface BulkStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many rows are ticked. Quoted back so the action is unambiguous. */
  selectedCount: number;
  isSaving?: boolean;
  onConfirm: (status: SnagStatus) => Promise<boolean>;
}

/**
 * "Set status" over the ticked rows. ADMIN ONLY — the caller decides whether
 * this ever renders (see `config/snagPermissions.ts`); this component does not
 * re-derive the rule.
 *
 * THERE IS NO REMARK BOX HERE, DELIBERATELY (owner decision Q12a, ADR-0018): one
 * sentence applied to N rows would overwrite N different remarks, and a remark
 * overwrite destroys the imported text. The single-row path takes a remark; this
 * one never will.
 */
export const BulkStatusDialog: React.FC<BulkStatusDialogProps> = ({
  open,
  onOpenChange,
  selectedCount,
  isSaving = false,
  onConfirm,
}) => {
  const [status, setStatus] = React.useState<SnagStatus>("Completed");

  const handleConfirm = async () => {
    const ok = await onConfirm(status);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set status</DialogTitle>
          <DialogDescription>
            This sets the status of{" "}
            <span className="font-semibold text-foreground">
              {selectedCount} selected snag{selectedCount === 1 ? "" : "s"}
            </span>
            . Each row keeps its own history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as SnagStatus)}
          >
            <SelectTrigger aria-label="New status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SNAG_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSaving || selectedCount === 0}
          >
            {isSaving ? "Updating…" : `Set ${selectedCount} to ${status}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
