import * as React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FileText, Clock, Package, RefreshCw, Sparkles, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/* ─────────────────────────────────────────────────────────────
   DRAFT RESUME DIALOG

   Dialog shown when user returns to form with an existing draft.
   Allows resuming previous work or starting fresh.

   Design: Welcoming, encouraging tone with clear choices.
   ───────────────────────────────────────────────────────────── */

interface DraftResumeDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback when user chooses to resume draft */
  onResume: () => void;
  /** Callback when user chooses to start fresh */
  onStartFresh: () => void;
  /** ISO timestamp of when draft was last saved */
  draftDate: string | null;
  /** Work package name (if available) */
  workPackage?: string | null;
  /** Current step the draft was on */
  currentStep?: number;
  /** Total steps */
  totalSteps?: number;
  /** PR ID for Approve PR flow (if available) */
  prId?: string | null;
  /** Created by user name for Approve PR flow (if available) */
  createdBy?: string | null;
}

export const DraftResumeDialog: React.FC<DraftResumeDialogProps> = ({
  open,
  onOpenChange,
  onResume,
  onStartFresh,
  draftDate,
  workPackage,
  currentStep,
  totalSteps = 6,
  prId,
  createdBy,
}) => {
  // Determine if this is a PR context (has prId)
  const isPRContext = !!prId;
  // Format the relative time
  const relativeTime = React.useMemo(() => {
    if (!draftDate) return null;
    try {
      return formatDistanceToNow(new Date(draftDate), { addSuffix: true });
    } catch {
      return null;
    }
  }, [draftDate]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="space-y-4">
          {/* Icon badge with subtle animation */}
          <div className="mx-auto sm:mx-0 relative">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            {/* Decorative sparkle */}
            <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-amber-500 animate-pulse" />
          </div>

          <div className="space-y-2">
            <AlertDialogTitle className="text-lg font-semibold">
              {isPRContext
                ? `Resume previous draft for ${prId}?`
                : 'Resume Previous Draft?'}
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {isPRContext
                    ? 'You have unsaved changes from a previous session. Would you like to continue where you left off?'
                    : 'You have an unfinished project setup. Would you like to continue where you left off?'}
                </p>

                {/* Draft preview card */}
                <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                  {/* Work Package row */}
                  {workPackage && (
                    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50">
                      <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 shrink-0">
                        <Package className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Work Package
                        </p>
                        <p className="text-sm font-medium text-foreground truncate">
                          {workPackage}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Created by row (PR context only) */}
                  {createdBy && (
                    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50">
                      <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Created by
                        </p>
                        <p className="text-sm font-medium text-foreground truncate">
                          {createdBy}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Metadata row */}
                  <div className="flex items-center divide-x divide-border/50">
                    {/* Last saved */}
                    {relativeTime && (
                      <div className="flex-1 flex items-center gap-2 px-3 py-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">
                          Saved {relativeTime}
                        </span>
                      </div>
                    )}

                    {/* Progress */}
                    {currentStep !== undefined && (
                      <div className="flex-1 px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          Step {currentStep + 1} of {totalSteps}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          {/* Secondary: Start Fresh */}
          <Button
            variant="outline"
            onClick={onStartFresh}
            className="w-full sm:w-auto justify-center gap-2 order-2 sm:order-1"
          >
            <RefreshCw className="w-4 h-4" />
            Start Fresh
          </Button>

          {/* Primary: Resume */}
          <Button
            onClick={onResume}
            className="w-full sm:w-auto justify-center gap-2 order-1 sm:order-2"
          >
            <FileText className="w-4 h-4" />
            Resume Draft
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DraftResumeDialog;
