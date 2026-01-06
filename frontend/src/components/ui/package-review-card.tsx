import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Package, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useBreakpoint } from '@/hooks/useMediaQuery';

/* ─────────────────────────────────────────────────────────────
   TYPES
   ───────────────────────────────────────────────────────────── */

interface CategoryMake {
  label: string;
  value?: string;
}

interface Category {
  name: string;
  makes: CategoryMake[];
}

interface WorkPackage {
  work_package_name: string;
  category_list?: {
    list: Category[];
  };
}

/* ─────────────────────────────────────────────────────────────
   CATEGORY BADGE COMPONENT
   ───────────────────────────────────────────────────────────── */

interface CategoryBadgeProps {
  category: Category;
  showMakes?: boolean;
}

const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category, showMakes = false }) => {
  const makeCount = category.makes?.length || 0;

  if (!showMakes) {
    return (
      <Badge variant="secondary" className="font-normal gap-1.5">
        {category.name}
        {makeCount > 0 && (
          <span className="text-xs text-muted-foreground">({makeCount})</span>
        )}
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{category.name}</span>
        {makeCount === 0 && (
          <span className="text-xs text-muted-foreground">(No makes selected)</span>
        )}
      </div>
      {makeCount > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-3">
          {category.makes.map((make, idx) => (
            <Badge key={idx} variant="outline" className="text-xs font-normal">
              {make.label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   PACKAGE REVIEW CARD COMPONENT
   ───────────────────────────────────────────────────────────── */

interface PackageReviewCardProps {
  workPackage: WorkPackage;
  onEdit?: () => void;
  defaultExpanded?: boolean;
  className?: string;
}

export const PackageReviewCard: React.FC<PackageReviewCardProps> = ({
  workPackage,
  onEdit,
  defaultExpanded,
  className,
}) => {
  const { isMobile } = useBreakpoint();
  const [isOpen, setIsOpen] = React.useState(defaultExpanded ?? !isMobile);

  const categories = workPackage.category_list?.list || [];
  const categoryCount = categories.length;
  const makeCount = categories.reduce((acc, cat) => acc + (cat.makes?.length || 0), 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <div className="border border-border rounded-lg overflow-hidden bg-card hover:border-primary/30 transition-colors">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-accent/50 transition-colors text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 shrink-0">
                <Package className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground truncate">
                  {workPackage.work_package_name}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {categoryCount} {categoryCount === 1 ? 'category' : 'categories'} · {makeCount} {makeCount === 1 ? 'make' : 'makes'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform duration-200',
                  isOpen && 'rotate-180'
                )}
              />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-1 border-t border-border">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No categories selected
              </p>
            ) : (
              <div className="space-y-3 pt-3">
                {categories.map((category, idx) => (
                  <CategoryBadge key={idx} category={category} showMakes />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

/* ─────────────────────────────────────────────────────────────
   PACKAGES REVIEW GRID COMPONENT
   ───────────────────────────────────────────────────────────── */

interface PackagesReviewGridProps {
  workPackages: WorkPackage[];
  onEdit?: () => void;
  className?: string;
}

export const PackagesReviewGrid: React.FC<PackagesReviewGridProps> = ({
  workPackages,
  onEdit,
  className,
}) => {
  const { isDesktop } = useBreakpoint();

  if (!workPackages || workPackages.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No packages selected</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid gap-3',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className
      )}
    >
      {workPackages.map((wp, index) => (
        <PackageReviewCard
          key={index}
          workPackage={wp}
          onEdit={onEdit}
          defaultExpanded={isDesktop}
        />
      ))}
    </div>
  );
};

export default PackageReviewCard;
