import * as React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ─────────────────────────────────────────────────────────────
   FORM RESET WARNING DIALOG

   Compact warning dialog for unsaved changes. Enterprise-minimal
   design with amber accent and decisive action buttons.
   ───────────────────────────────────────────────────────────── */

interface FormResetWarningDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title - defaults to "Discard Changes?" */
  title?: string;
  /** Dialog description - defaults to standard warning text */
  description?: string;
  /** Callback when user confirms discarding and leaving */
  onDiscard: () => void;
  /** Callback when user wants to continue editing */
  onContinue: () => void;
}

export const FormResetWarningDialog: React.FC<FormResetWarningDialogProps> = ({
  open,
  onOpenChange,
  title = 'Unsaved Changes',
  description = 'Your changes will be lost if you leave now.',
  onDiscard,
  onContinue,
}) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={cn(
          "max-w-[340px] p-0 gap-0 overflow-hidden",
          "border-0 shadow-xl",
          "bg-white dark:bg-slate-950"
        )}
      >
        {/* Amber accent bar */}
        <div className="h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />

        {/* Content - compact single section */}
        <div className="px-5 pt-4 pb-5">
          {/* Title + Description */}
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              {title}
            </h3>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {description}
            </p>
          </div>

          {/* Action buttons - horizontal, right-aligned */}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              className={cn(
                "h-8 px-3 text-[13px] font-medium",
                "text-slate-600 dark:text-slate-400",
                "hover:text-red-600 hover:bg-red-50",
                "dark:hover:text-red-400 dark:hover:bg-red-950/30",
                "transition-colors duration-150"
              )}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={onContinue}
              className={cn(
                "h-8 px-4 text-[13px] font-medium",
                "bg-slate-900 hover:bg-slate-800 text-white",
                "dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900",
                "shadow-sm transition-colors duration-150"
              )}
            >
              Keep Editing
            </Button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default FormResetWarningDialog;
