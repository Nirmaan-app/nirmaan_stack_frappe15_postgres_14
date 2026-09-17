/**
 * Facet options for the unified approval queue.
 *
 * ⚠️ WHY NOT THE SELF-FETCHING FACETS (`facetDoctype` + `meta.facet`).
 *
 * That path reads ONE doctype. This screen's rows come from a UNION of three, so
 * a facet fetched from `Project Payments` would offer no `Type` values at all,
 * and would list only the projects and vendors that appear on PAYMENTS — while
 * the table beside it shows expense rows from projects the filter cannot name.
 * A facet that cannot name what is on screen is worse than no facet.
 *
 * So facets come from `get_approval_queue_facets`, which groups over the same
 * union the table reads.
 *
 * EVERY OPTION CARRIES ITS COUNT, AND AN OPTION THAT WOULD MATCH NOTHING IS NOT OFFERED
 * (owner, 17 Sep 2026). Counts follow what the table shows — the tab's filters, the OTHER
 * column filters and the search box — the same cross-filter rule as `useFacetValues`: a
 * facet's OWN selection is left out, or picking one value would hide all its siblings.
 * The server only returns values that occur, so a zero never reaches the list.
 *
 * LAZY, like `SelfFetchingFacetFilter`: nothing is fetched until a facet's popover is first
 * opened (`onFacetOpen`, wired to DataTable), then it stays live for the tab's lifetime.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnFiltersState } from "@tanstack/react-table";
import { useFrappeGetCall } from "frappe-react-sdk";

import { convertTanstackFiltersToFrappe } from "@/lib/frappeTypeUtils";
import { TYPE_LABEL } from "./approvalsTable.config";

const FACET_API =
  "nirmaan_stack.api.approvals.get_approval_queue.get_approval_queue_facets";

const NO_VALUES: { value: string; count: number }[] = [];

/** Matches the table's own search debounce, so the counts do not refetch per keystroke. */
const SEARCH_DEBOUNCE_MS = 400;

interface FacetResponse {
  message: {
    field: string;
    values: { value: string; count: number }[];
    blank_count: number;
  };
}

export interface FacetOptionMap {
  [columnId: string]: {
    title: string;
    options: { label: string; value: string }[];
    isLoading?: boolean;
  };
}

export interface UseApprovalFacetsArgs {
  /** The tab's own filters. */
  filters: Array<[string, string, unknown]>;
  /** The table's live column filters and search, from `useServerDataTable`. */
  columnFilters: ColumnFiltersState;
  searchTerm: string;
  selectedSearchField: string;
  /** Id -> display name; the endpoint returns ids, the filter shows names. */
  projectLabels: Map<string, string>;
  vendorLabels: Map<string, string>;
  /** Owner email -> full name, for "Raised by". */
  userLabels?: Map<string, string>;
  /** Whether the Status facet is meaningful (only on a mixed-status tab). */
  includeStatus?: boolean;
}

export interface UseApprovalFacetsResult {
  facetOptions: FacetOptionMap;
  /** Pass to DataTable's `onFacetOpen` — a facet fetches on its first open. */
  onFacetOpen: (columnId: string) => void;
}

/** One facet. The column id IS the server field for every facet on this screen. */
function useQueueFacet(
  field: string,
  enabled: boolean,
  tabFilters: Array<[string, string, unknown]>,
  columnFilters: ColumnFiltersState,
  searchTerm: string,
  selectedSearchField: string,
) {
  const params = useMemo(() => {
    const others = columnFilters.filter((f) => f.id !== field);
    const filters = [...tabFilters, ...convertTanstackFiltersToFrappe(others)];
    return {
      field,
      filters: JSON.stringify(filters),
      search_term: searchTerm || undefined,
      current_search_fields: searchTerm && selectedSearchField ? JSON.stringify([selectedSearchField]) : undefined,
    };
  }, [field, tabFilters, columnFilters, searchTerm, selectedSearchField]);

  const { data, isLoading } = useFrappeGetCall<FacetResponse>(
    FACET_API,
    params,
    enabled ? `approval-facet-${JSON.stringify(params)}` : null,
    // Keep the previous list on screen while a filter change refetches it.
    { keepPreviousData: true },
  );
  // Memoised so an unchanged facet keeps its identity and the option map below stays stable.
  return useMemo(
    () => ({ values: data?.message?.values ?? NO_VALUES, isLoading: enabled && isLoading }),
    [data, enabled, isLoading],
  );
}

export function useApprovalFacets({
  filters,
  columnFilters,
  searchTerm,
  selectedSearchField,
  projectLabels,
  vendorLabels,
  userLabels,
  includeStatus = false,
}: UseApprovalFacetsArgs): UseApprovalFacetsResult {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const onFacetOpen = useCallback((columnId: string) => {
    setOpened((prev) => (prev.has(columnId) ? prev : new Set(prev).add(columnId)));
  }, []);

  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // `filters` arrives as a fresh array from some callers; key it on its CONTENT so an
  // identical tab filter does not churn every facet's params.
  const filtersKey = JSON.stringify(filters);
  const tabFilters = useMemo(() => JSON.parse(filtersKey) as Array<[string, string, unknown]>, [filtersKey]);

  const common = [tabFilters, columnFilters, debouncedSearch, selectedSearchField] as const;
  const type = useQueueFacet("source_type", opened.has("source_type"), ...common);
  const project = useQueueFacet("project", opened.has("project"), ...common);
  const vendor = useQueueFacet("vendor", opened.has("vendor"), ...common);
  const status = useQueueFacet("status", includeStatus && opened.has("status"), ...common);
  const raisedBy = useQueueFacet("raised_by", opened.has("raised_by"), ...common);

  const facetOptions = useMemo(() => {
    const withCounts = (
      field: string,
      values: { value: string; count: number }[],
      labelFor: (value: string) => string,
    ) => {
      // A blank is a TRUE value here (a non-project expense has no project and no vendor),
      // but it cannot be expressed as a filter option, so those rows are not reachable
      // through a facet. Deliberate: the Type facet is how you isolate them.
      const options = values
        .filter((v) => (v.value ?? "").trim() && v.count > 0)
        .map((v) => ({ label: `${labelFor(v.value)} (${v.count})`, value: v.value }));
      // The ONE exception to "no zero options": a value that is already TICKED stays listed
      // (at 0) when other filters empty it, or it could no longer be unticked on its own.
      const selected = columnFilters.find((f) => f.id === field)?.value;
      if (Array.isArray(selected)) {
        const listed = new Set(options.map((o) => o.value));
        for (const v of selected as string[]) {
          if (!listed.has(v)) options.push({ label: `${labelFor(v)} (0)`, value: v });
        }
      }
      return options;
    };

    const map: FacetOptionMap = {
      // Keyed by the COLUMN ID, which is the server field on every facet here.
      source_type: {
        title: "Type",
        isLoading: type.isLoading,
        options: withCounts("source_type", type.values, (v) => TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? v),
      },
      project: {
        title: "Project",
        isLoading: project.isLoading,
        options: withCounts("project", project.values, (v) => projectLabels.get(v) || v),
      },
      vendor: {
        title: "Vendor",
        isLoading: vendor.isLoading,
        options: withCounts("vendor", vendor.values, (v) => vendorLabels.get(v) || v),
      },
      raised_by: {
        title: "Raised by",
        isLoading: raisedBy.isLoading,
        // Falls back to the email when the user has no Nirmaan Users row, as the cell does.
        options: withCounts("raised_by", raisedBy.values, (v) => userLabels?.get(v) || v),
      },
    };
    if (includeStatus) {
      map.status = { title: "Status", isLoading: status.isLoading, options: withCounts("status", status.values, (v) => v) };
    }
    return map;
  }, [type, project, vendor, status, raisedBy, columnFilters, projectLabels, vendorLabels, userLabels, includeStatus]);

  return { facetOptions, onFacetOpen };
}
