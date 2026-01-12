import * as React from 'react';
import { cn } from '@/lib/utils';
import { Cloud, CloudOff, Loader2 } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────
   DRAFT INDICATOR

   A subtle, unobtrusive indicator showing draft save status.
   Designed to be present but not distracting.
   ───────────────────────────────────────────────────────────── */

interface DraftIndicatorProps {
  /** Relative time text, e.g., "5 minutes ago" */
  lastSavedText: string | null;
  /** Whether currently saving */
  isSaving?: boolean;
  /** Whether there's an error with saving */
  hasError?: boolean;
  /** Additional class names */
  className?: string;
}

export const DraftIndicator: React.FC<DraftIndicatorProps> = ({
  lastSavedText,
  isSaving = false,
  hasError = false,
  className,
}) => {
  // Don't render if no saved state and not saving
  if (!lastSavedText && !isSaving) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
        'text-xs font-medium transition-all duration-300 ease-out',
        'select-none',
        // State-based styling
        isSaving && 'text-muted-foreground bg-muted/50',
        !isSaving && !hasError && 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
        hasError && 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
        className
      )}
      role="status"
      aria-live="polite"
    >
      {/* Icon */}
      <span className="relative flex items-center justify-center w-3.5 h-3.5">
        {isSaving ? (
          <Loader2
            className="w-3.5 h-3.5 animate-spin"
            strokeWidth={2.5}
          />
        ) : hasError ? (
          <CloudOff className="w-3.5 h-3.5" strokeWidth={2} />
        ) : (
          <>
            <Cloud
              className="w-3.5 h-3.5 transition-transform duration-300"
              strokeWidth={2}
            />
            {/* Subtle pulse on save completion */}
            <span
              className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping"
              style={{ animationDuration: '2s', animationIterationCount: '1' }}
            />
          </>
        )}
      </span>

      {/* Status text */}
      <span className="hidden sm:inline whitespace-nowrap">
        {isSaving ? (
          'Saving...'
        ) : hasError ? (
          'Save failed'
        ) : (
          <>Draft saved {lastSavedText}</>
        )}
      </span>

      {/* Mobile: Show abbreviated text */}
      <span className="sm:hidden whitespace-nowrap">
        {isSaving ? 'Saving...' : hasError ? 'Error' : 'Saved'}
      </span>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   DRAFT HEADER

   Container component for placing draft controls in form header.
   Provides consistent layout for Cancel button + Draft indicator.
   ───────────────────────────────────────────────────────────── */

interface DraftHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export const DraftHeader: React.FC<DraftHeaderProps> = ({
  children,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-4 sm:px-6 py-2',
        'border-b border-border/50 bg-muted/20',
        className
      )}
    >
      {children}
    </div>
  );
};

export default DraftIndicator;
