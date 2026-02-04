import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Save, Trash2, ArrowLeft } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────
   DRAFT CANCEL DIALOG

   Confirmation dialog when user attempts to cancel/exit the form.
   Provides options to save draft, discard, or continue editing.

   Design: Enterprise minimalist with clear visual hierarchy.
   ───────────────────────────────────────────────────────────── */

interface DraftCancelDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title - defaults to "Cancel Project Setup?" */
  title?: string;
  /** Callback when user chooses to save draft and exit */
  onSaveDraft: () => void;
  /** Callback when user chooses to discard and exit */
  onDiscard: () => void;
  /** Callback when user chooses to continue editing */
  onCancel: () => void;
  /** Current step number (1-indexed for display) */
  currentStep?: number;
  /** Total number of steps */
  totalSteps?: number;
  /** Whether save action is loading */
  isSaving?: boolean;
}

export const DraftCancelDialog: React.FC<DraftCancelDialogProps> = ({
  open,
  onOpenChange,
  title = "Cancel Project Setup?",
  onSaveDraft,
  onDiscard,
  onCancel,
  currentStep = 1,
  totalSteps = 6,
  isSaving = false,
}) => {
  // Calculate progress percentage
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="space-y-4">
          {/* Icon badge */}
          <div className="mx-auto sm:mx-0 flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30">
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>

          <div className="space-y-2">
            <AlertDialogTitle className="text-lg font-semibold">
              {title}
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  You have unsaved progress. Choose what you'd like to do with your changes.
                </p>

                {/* Progress indicator */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        Step {currentStep} of {totalSteps}
                      </span>
                      <span className="text-muted-foreground">
                        {progressPercent}% complete
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {/* Primary action: Save Draft */}
          <Button
            onClick={onSaveDraft}
            disabled={isSaving}
            className="w-full justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Draft & Exit'}
          </Button>

          {/* Secondary actions row */}
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            {/* Destructive: Discard */}
            <Button
              variant="outline"
              onClick={onDiscard}
              disabled={isSaving}
              className={cn(
                'flex-1 justify-center gap-2',
                'text-destructive hover:text-destructive hover:bg-destructive/10',
                'border-destructive/30 hover:border-destructive/50'
              )}
            >
              <Trash2 className="w-4 h-4" />
              Discard & Exit
            </Button>

            {/* Neutral: Continue */}
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={isSaving}
              className="flex-1 justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Continue Editing
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DraftCancelDialog;
