import { useEffect, useMemo, useState } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';
import { ColumnFiltersState } from '@tanstack/react-table';

import { convertTanstackFiltersToFrappe } from '@/lib/frappeTypeUtils';

const FACETS_METHOD = 'nirmaan_stack.api.assets.history.get_asset_history_facets';
const SEARCH_DEBOUNCE_MS = 300;

export type HistoryFacetField = 'event' | 'assigned_to' | 'done_by' | 'department';

/** One choice of a header filter and how many rows it has, as `get_asset_history_facets` returns it. */
export interface HistoryFacetCount {
    value: string;
    label: string;
    count: number;
}

export interface HistoryFacetCounts {
    /** undefined until that filter has been opened once (and while its first fetch runs). */
    counts: Partial<Record<HistoryFacetField, HistoryFacetCount[]>>;
    loading: Partial<Record<HistoryFacetField, boolean>>;
}

/**
 * The counts beside the History table's header filter choices (owner, 2026-10-15). The shared
 * `get_facet_values` can't read the Asset History child table, so these come from the History endpoint's own
 * counter. Lazy like the shared facets: a filter fetches nothing until it is first opened (`opened`), then
 * refetches whenever the other filters or the search change. Its own filter is left out of its key, so
 * picking a value doesn't reload the list being picked from.
 */
export function useAssetHistoryFacets(
    opened: ReadonlySet<string>,
    columnFilters: ColumnFiltersState,
    searchTerm: string
): HistoryFacetCounts {
    // The table waits for typing to stop before it searches; the counts wait the same.
    const [search, setSearch] = useState(searchTerm);
    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const filters = useMemo(() => convertTanstackFiltersToFrappe(columnFilters), [columnFilters]);

    const event = useFacetCounts('event', opened.has('event'), filters, search);
    const assignedTo = useFacetCounts('assigned_to', opened.has('assigned_to'), filters, search);
    const doneBy = useFacetCounts('done_by', opened.has('done_by'), filters, search);
    const department = useFacetCounts('department', opened.has('department'), filters, search);

    return {
        counts: { event: event.values, assigned_to: assignedTo.values, done_by: doneBy.values, department: department.values },
        loading: { event: event.loading, assigned_to: assignedTo.loading, done_by: doneBy.loading, department: department.loading },
    };
}

function useFacetCounts(field: HistoryFacetField, enabled: boolean, filters: ReturnType<typeof convertTanstackFiltersToFrappe>, search: string) {
    const otherFilters = JSON.stringify(filters.filter((item) => !(Array.isArray(item) && item[0] === field)));
    const { data, isLoading } = useFrappeGetCall<{ message: { values: HistoryFacetCount[] } }>(
        FACETS_METHOD,
        { field, filters: otherFilters, search_term: search || undefined },
        enabled ? `asset_history_facets:${field}:${otherFilters}:${search}` : null,
        { keepPreviousData: true }
    );
    return { values: data?.message?.values, loading: enabled && isLoading };
}
