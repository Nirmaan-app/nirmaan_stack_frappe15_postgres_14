import type { ColumnFiltersState } from "@tanstack/react-table";

import type { PartiallyReconciledFigure, PartiallyReconciledItem } from "@/pages/reports/hooks/usePartiallyReconciled";

/** The fields of a part-reconciled expense a facet or the search box can read, by the column's id. */
const fieldOf = (item: PartiallyReconciledItem, field: string): string | null => {
  switch (field) {
    case "name": return item.name;
    case "type": return item.type;
    case "description": return item.description;
    case "amount": return String(item.amount);
    default: return null;
  }
};

/**
 * The part of the Payments Report (Non-Project)'s "+ Partially Reconciled" money its filters keep (walk W7,
 * story 65), as the Project report's add-on already follows its filters
 * (`reports/utils/outflowReportSummary.reconciledInReportFilters`): a facet (a list of values) on a field
 * the record carries keeps the records whose value is in it, and the search keeps those whose searched
 * field contains it, as the table's server-side search does. A filter on a field the record does not
 * carry (dates: the range already is the hook's) keeps them.
 */
export const nonProjectReconciledInFilters = (
  items: PartiallyReconciledItem[],
  columnFilters: ColumnFiltersState,
  search: string,
  searchField: string,
): PartiallyReconciledFigure => {
  const term = search.trim().toLowerCase();
  const kept = items.filter((item) => {
    const facetsHold = columnFilters.every((filter) => {
      const value = fieldOf(item, filter.id);
      if (value === null || !Array.isArray(filter.value) || filter.value.length === 0) return true;
      return (filter.value as unknown[]).map(String).includes(value);
    });
    if (!facetsHold) return false;
    if (!term) return true;
    return (fieldOf(item, searchField) ?? "").toLowerCase().includes(term);
  });
  return { amount: kept.reduce((sum, item) => sum + item.amount, 0), count: kept.length, items: kept };
};
