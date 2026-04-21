import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";

interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed reason (guaranteed ≥ 10 chars, ≤ 500). */
  onConfirm: (reason: string) => void | Promise<void>;
  loading?: boolean;
  itmName?: string;
}

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

/**
 * Reject-with-reason modal.
 *
 * Mirrors the backend contract (`reject_itm` requires ≥10 chars after trim).
 * The submit button stays disabled until the user meets the minimum so we
 * fail fast on the client. On success the parent closes this dialog.
 *
 * We reset local state on `open=true` so reopening after a cancel starts fresh.
 */
export const RejectDialog: React.FC<RejectDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
  itmName,
}) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const trimmedLength = reason.trim().length;
  const canSubmit = trimmedLength >= MIN_REASON_LENGTH && !loading;

  const handleConfirm = async () => {
    if (trimmedLength < MIN_REASON_LENGTH) {
      setError(`Please provide at least ${MIN_REASON_LENGTH} characters.`);
      return;
    }
    setError(null);
    await onConfirm(reason.trim());
  };

  const handleChange = (val: string) => {
    // Hard cap — prevents the user typing past the limit.
    setReason(val.slice(0, MAX_REASON_LENGTH));
    if (error) setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Reject Internal Transfer Memo</DialogTitle>
          <DialogDescription>
            Please provide a reason. This will be shown to the creator when they
            view the rejected request
            {itmName ? (
              <>
                {" "}
                (<span className="font-mono">{itmName}</span>)
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">
              Rejection is a terminal action. The creator will need to submit a
              new request if changes are needed.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="itm-reject-reason" className="text-sm font-medium">
              Reason for rejection
              <span className="text-destructive ml-1">*</span>
            </Label>
            <Textarea
              id="itm-reject-reason"
              value={reason}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="Explain why this transfer request is being rejected (missing info, conflicting availability, wrong target project, etc.)"
              rows={5}
              className={error ? "border-destructive focus-visible:ring-destructive" : ""}
              disabled={loading}
            />
            <div className="flex items-center justify-between text-xs">
              <span
                className={
                  error
                    ? "text-destructive"
                    : trimmedLength >= MIN_REASON_LENGTH
                      ? "text-muted-foreground"
                      : "text-muted-foreground"
                }
              >
                {error
                  ? error
                  : trimmedLength < MIN_REASON_LENGTH
                    ? `Minimum ${MIN_REASON_LENGTH} characters`
                    : " "}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {reason.length} / {MAX_REASON_LENGTH} chars
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {loading ? "Rejecting..." : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RejectDialog;
