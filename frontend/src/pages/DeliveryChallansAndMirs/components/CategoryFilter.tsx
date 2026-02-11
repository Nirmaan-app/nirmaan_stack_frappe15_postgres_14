import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Filter, X } from "lucide-react";

interface CategoryFilterProps {
  categories: string[];
  categoryCounts: Record<string, number>;
  selectedCategories: string[];
  filteredPOCount: number;
  onToggleCategory: (category: string) => void;
  onClearFilters: () => void;
}

export const CategoryFilter = ({
  categories,
  categoryCounts,
  selectedCategories,
  filteredPOCount,
  onToggleCategory,
  onClearFilters,
}: CategoryFilterProps) => {
  if (categories.length === 0) return null;

  return (
    <Accordion type="single" collapsible className="mb-4">
      <AccordionItem value="category-filter" className="border rounded-lg">
        <AccordionTrigger className="px-4 hover:no-underline">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Filter by Category</h3>
            {selectedCategories.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {selectedCategories.length} selected
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <div className="flex items-center justify-end mb-3">
            {selectedCategories.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                className="h-7 text-xs"
                aria-label="Clear all category filters"
              >
                <X className="h-3 w-3 mr-1" aria-hidden="true" />
                Clear Filters
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const isSelected = selectedCategories.includes(category);
              const count = categoryCounts[category] || 0;
              return (
                <Button
                  key={category}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => onToggleCategory(category)}
                  className="h-8 text-xs"
                  aria-pressed={isSelected}
                >
                  {category}
                  <Badge
                    variant={isSelected ? "secondary" : "outline"}
                    className="ml-2 h-5 px-1.5"
                  >
                    {count}
                  </Badge>
                </Button>
              );
            })}
          </div>
          {filteredPOCount === 0 && selectedCategories.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              No POs found matching the selected categories
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
