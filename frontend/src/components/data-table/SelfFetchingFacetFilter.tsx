import * as React from "react";
import { Column, ColumnFiltersState } from "@tanstack/react-table";

import { useFacetValues } from "@/hooks/useFacetValues";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { FacetDeclaration, FacetOverride, NOT_SET_FACET_VALUE } from "./facetConfig";

// Stable module-level empties so a decoupled facet / an override-less facet does not hand
// useFacetValues a fresh [] ref every render (which would churn its filter memo).
const EMPTY_FILTERS: ColumnFiltersState = [];
const EMPTY_ADDITIONAL: any[] = [];

interface SelfFetchingFacetFilterProps {
  column: Column<any, any>;
  /** The table's list doctype — the default source for the facet aggregation. */
  doctype: string;
  /** STATIC facet identity, read off `column.columnDef.meta.facet` by DataTable. */
  facet: FacetDeclaration;
  /** RENDER-scope context for this column id, from the DataTable `facetOverrides` prop. */
  override?: FacetOverride;
  /** Live table state, injected by DataTable. Ignored when `facet.decoupled`. */
  columnFilters: ColumnFiltersState;
  searchTerm: string;
  selectedSearchField: string;
}

/**
 * Self-fetching faceted filter — the ONE home for the facet-fetch pattern (ADR-0010 F2/F4).
 *
 * Owns the `useFacetValues` call plus a STICKY lazy gate: the first popover-open flips fetching
 * ON and it stays on for the component's lifetime (refetching on filter/search change), exactly
 * replicating the #2b `touchedFacets` behaviour — zero facet requests until first open, then
 * cross-filter-correct counts on every reopen. Reuses the presentational DataTableFacetedFilter.
 *
 * Laziness resets naturally when the component unmounts (e.g. `key={tab}` remount on the PO
 * route), matching the previous per-tab `touchedFacets` reset.
 */
export function SelfFetchingFacetFilter({
  column,
  doctype,
  facet,
  override,
  columnFilters,
  searchTerm,
  selectedSearchField,
}: SelfFetchingFacetFilterProps) {
  const [openedOnce, setOpenedOnce] = React.useState(false);
  const decoupled = facet.decoupled === true;

  const { facetOptions, isLoading } = useFacetValues({
    doctype: facet.doctype ?? doctype,
    field: facet.field,
    currentFilters: decoupled ? EMPTY_FILTERS : columnFilters,
    searchTerm: decoupled ? "" : searchTerm,
    selectedSearchField: decoupled ? "name" : selectedSearchField,
    additionalFilters: override?.additionalFilters ?? EMPTY_ADDITIONAL,
    requirePendingItems: facet.requirePendingItems ?? false,
    includeBlankBucket: facet.includeBlankBucket ?? false,
    enabled: openedOnce, // sticky-live lazy gate — flips true on first open, stays true
  });

  // The backend returns the blank bucket with the raw sentinel as its label (naming the
  // empty state is a UI concern — "Not Linked" here, "Unassigned" elsewhere). Swap in the
  // declared label for DISPLAY only; the option's `value` stays the sentinel, which is what
  // travels back as the filter and what the backend rewrites to `is not set`.
  const options = React.useMemo(() => {
    if (!facet.includeBlankBucket) return facetOptions;
    const blankLabel = facet.blankLabel ?? "Not Set";
    return facetOptions.map((o) =>
      o.value === NOT_SET_FACET_VALUE ? { ...o, label: blankLabel } : o
    );
  }, [facetOptions, facet.includeBlankBucket, facet.blankLabel]);

  return (
    <DataTableFacetedFilter
      column={column}
      title={facet.title}
      options={options}
      isLoading={isLoading}
      onOpenChange={(open) => {
        if (open) setOpenedOnce(true);
      }}
    />
  );
}
