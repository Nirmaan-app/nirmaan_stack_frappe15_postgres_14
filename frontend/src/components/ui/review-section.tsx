import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Pencil, LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

/* ─────────────────────────────────────────────────────────────
   REVIEW DETAIL COMPONENT

   Displays a label-value pair in a stacked, scannable format
   ───────────────────────────────────────────────────────────── */

interface ReviewDetailProps {
  label: string;
  value: React.ReactNode;
  className?: string;
  emptyText?: string;
}

export const ReviewDetail: React.FC<ReviewDetailProps> = ({
  label,
  value,
  className,
  emptyText = '—',
}) => {
  const isEmpty = value === null || value === undefined || value === '';

  return (
    <div className={cn('space-y-1', className)}>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'text-sm font-medium',
          isEmpty ? 'text-muted-foreground/60' : 'text-foreground'
        )}
      >
        {isEmpty ? emptyText : value}
      </dd>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   REVIEW SECTION COMPONENT

   Collapsible section wrapper with header, icon, and edit action
   ───────────────────────────────────────────────────────────── */

interface ReviewSectionProps {
  title: string;
  icon?: LucideIcon;
  onEdit?: () => void;
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  className?: string;
  iconColorClass?: string;
}

export const ReviewSection: React.FC<ReviewSectionProps> = ({
  title,
  icon: Icon,
  onEdit,
  children,
  columns = 2,
  collapsible = false,
  defaultExpanded = true,
  className,
  iconColorClass = 'bg-primary/10 text-primary',
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultExpanded);

  const gridClasses = cn(
    'grid gap-x-6 gap-y-4',
    columns === 1 && 'grid-cols-1',
    columns === 2 && 'grid-cols-1 sm:grid-cols-2',
    columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  );

  const headerContent = (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className={cn(
              'flex items-center justify-center h-10 w-10 rounded-lg shrink-0',
              iconColorClass
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>

      <div className="flex items-center gap-2">
        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="h-9 px-3 text-muted-foreground hover:text-primary hover:bg-primary/5 gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        )}

        {collapsible && (
          <ChevronDown
            className={cn(
              'h-5 w-5 text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        )}
      </div>
    </div>
  );

  if (collapsible) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full px-4 py-3 sm:px-6 sm:py-4 hover:bg-accent/50 transition-colors text-left"
            >
              {headerContent}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 sm:px-6 sm:pb-6 pt-2">
              <div className={gridClasses}>{children}</div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  }

  return (
    <div className={cn('border border-border rounded-lg overflow-hidden bg-card', className)}>
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border bg-muted/30">
        {headerContent}
      </div>
      <div className="px-4 py-4 sm:px-6 sm:py-6">
        <div className={gridClasses}>{children}</div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   REVIEW CONTAINER COMPONENT

   Main wrapper for all review sections with gradient background
   ───────────────────────────────────────────────────────────── */

interface ReviewContainerProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const ReviewContainer: React.FC<ReviewContainerProps> = ({
  title,
  description,
  children,
  className,
}) => {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-gradient-to-b from-background to-muted/20 overflow-hidden',
        className
      )}
    >
      {(title || description) && (
        <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-border bg-muted/40">
          {title && (
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          )}
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="p-4 sm:p-6 space-y-4">{children}</div>
    </div>
  );
};

export default ReviewSection;
