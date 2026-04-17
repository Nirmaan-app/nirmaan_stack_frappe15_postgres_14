import React from "react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ApproveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

/**
 * Confirmation modal shown before calling `approve_itm`.
 *
 * Uses the AlertDialog primitive (not Dialog) because this is a safety prompt
 * — there is no form input, just a confirm/cancel decision.
 */
export const ApproveConfirmDialog: React.FC<ApproveConfirmDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
}) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve this request?</AlertDialogTitle>
          <AlertDialogDescription>
            The creator will be notified and the source project will reserve the
            listed quantities. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Prevent auto-close — parent closes after mutation resolves,
              // so the dialog stays visible (with the loading state) if the
              // backend is slow or returns an error.
              e.preventDefault();
              onConfirm();
            }}
            disabled={loading}
            className={cn(buttonVariants({ variant: "default" }), "bg-red-600 hover:bg-red-700")}
          >
            {loading ? "Approving..." : "Approve"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ApproveConfirmDialog;
