// src/pages/outflow-import/useOutflowRows.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type {
    OutflowImportRow,
    OutflowRowsPage,
} from "@/types/NirmaanStack/OutflowImportBatch";

import {
    DEFAULT_HIDDEN_COLUMNS,
    DEFAULT_PAGE_SIZE,
    activeFilterCount,
    serverQuery,
    type ColumnFilters,
    type OutflowScope,
    type SortState,
} from "./outflowTableModel";

/**
 * One asking of `get_outflow_rows`: the query a person is building, and what came back.
 *
 * ⚠️ THIS EXISTS BECAUSE A SECOND SURFACE NEEDED THE SAME TABLE, AND COPYING IT WAS THE OBVIOUS
 * WRONG ANSWER. The search box, the per-column funnels, the sort, the paging and the facet fetch all
 * lived inside `OutflowMasterPage`. The Skipped dialog shows the same rows under a different scope,
 * and duplicating that state would put TWO ENGINES behind one question -- which is precisely what
 * the client-side filter engine was DELETED for at slice X3, and for the same reason: two answers to
 * "which rows match" disagree the day one of them is edited.
 *
 * ⚠️ IT OWNS THE QUERY, NOT THE WORK. Selection, decisions, the decision dialog and the row actions
 * stay with the caller, because they are not the same between the two surfaces: the page is a
 * worklist and the Skipped dialog is read-only. Folding those in would give the dialog a set of
 * affordances it must not have, guarded by a flag -- the shape that quietly grows a second product.
 *
 * ⚠️ THE SCOPE IS AN ARGUMENT, NOT STATE. The page derives it from the tab a person clicked; the
 * dialog is fixed to `skipped` for its whole life. A hook that owned the scope would have to be told
 * to change it anyway, and the tab already belongs to the page's own vocabulary.
 */
export interface OutflowRowsController {
    /** What the reviewer typed. Debounced before it reaches the server. */
    search: string;
    setSearch: (value: string) => void;

    filters: ColumnFilters;
    setFilter: (columnId: string, value: ColumnFilters[string]) => void;
    clearFilters: () => void;
    filterCount: number;

    sort: SortState;
    toggleSort: (columnId: string) => void;

    page: number;
    setPage: (page: number) => void;
    pageSize: number;

    hidden: Set<string>;
    setHidden: (hidden: Set<string>) => void;

    rows: OutflowImportRow[];
    total: number;
    loading: boolean;
    tabCounts?: OutflowRowsPage["tab_counts"];
    statusCounts?: OutflowRowsPage["status_counts"];

    /** Re-read the current page. The caller composes this with its own refreshes. */
    mutate: () => Promise<unknown>;
    /** One funnel's distinct values, fetched when it opens. */
    loadFacetValues: (columnId: string) => Promise<string[]>;
}

export interface UseOutflowRowsOptions {
    scope: OutflowScope;
    batch?: string;
    pageSize?: number;
    /** Skip the fetch entirely — a dialog that has not been opened should not query. */
    enabled?: boolean;
    /**
     * Columns to hide on top of the defaults.
     *
     * ⚠️ FOR COLUMNS THAT ARE MEANINGLESS IN THIS CONTEXT, not for taste. The Skipped dialog is
     * scoped to ONE import, so its Import column would repeat the same filename on every row and
     * cost the width that the Outcome — the only thing that says why a row was skipped — needs.
     */
    alsoHidden?: readonly string[];
}

export function useOutflowRows({
    scope,
    batch,
    pageSize = DEFAULT_PAGE_SIZE,
    enabled = true,
    alsoHidden,
}: UseOutflowRowsOptions): OutflowRowsController {
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [filters, setFilters] = useState<ColumnFilters>({});
    const [sort, setSort] = useState<SortState>({ columnId: "added_on", direction: "desc" });
    const [page, setPage] = useState(0);
    const [hidden, setHidden] = useState<Set<string>>(
        () => new Set([...DEFAULT_HIDDEN_COLUMNS, ...(alsoHidden ?? [])])
    );

    // Typing must not fire a query per keystroke now that search is a round trip.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Any change to what is being asked for resets to the first page. Without this, narrowing a
    // filter while on page 4 shows an empty table that looks like "no results".
    useEffect(() => {
        setPage(0);
    }, [scope, debouncedSearch, filters, sort, batch]);

    const rowsQuery = useMemo(
        () => serverQuery({ scope, query: debouncedSearch, filters, sort, page, pageSize, batch }),
        [scope, debouncedSearch, filters, sort, page, pageSize, batch]
    );

    const {
        data,
        isLoading,
        mutate,
    } = useFrappeGetCall<{ message: OutflowRowsPage }>(
        "nirmaan_stack.api.outflow_import.review.get_outflow_rows",
        // The SDK keys its cache on the arguments, so a JSON-serialisable object is what makes each
        // distinct query its own cache entry rather than one entry that keeps being overwritten.
        { ...rowsQuery, facets: JSON.stringify(rowsQuery.facets ?? {}) },
        enabled ? `outflow-rows-${JSON.stringify(rowsQuery)}` : null
    );

    const rows = useMemo(() => data?.message?.rows ?? [], [data]);

    /**
     * The facet values one funnel offers, fetched when it opens.
     *
     * ⚠️ IT SENDS EVERY FILTER EXCEPT THE FUNNEL'S OWN. A funnel that filtered its own options would
     * collapse to whatever is already ticked the moment it opened, and there would be no way back to
     * the values you unticked. The server enforces the same thing; this is the caller half.
     *
     * Held in a ref-stable callback because the table passes it straight into an effect dep.
     */
    const filtersRef = useRef(filters);
    filtersRef.current = filters;
    const searchRef = useRef(debouncedSearch);
    searchRef.current = debouncedSearch;

    const loadFacetValues = useCallback(
        async (columnId: string): Promise<string[]> => {
            const others: ColumnFilters = { ...filtersRef.current };
            delete others[columnId];
            const query = serverQuery({
                scope,
                query: searchRef.current,
                filters: others,
                batch,
            });
            const params = new URLSearchParams({ column: columnId, scope });
            if (query.batch) params.set("batch", query.batch);
            if (query.failed != null) params.set("failed", query.failed ? "1" : "0");
            if (query.search) params.set("search", query.search);
            if (query.amount_min != null) params.set("amount_min", String(query.amount_min));
            if (query.amount_max != null) params.set("amount_max", String(query.amount_max));

            const response = await fetch(
                `/api/method/nirmaan_stack.api.outflow_import.review.get_outflow_facet_values?${params}`,
                { headers: { Accept: "application/json" } }
            );
            if (!response.ok) throw new Error(`Could not load values (${response.status}).`);
            return (await response.json())?.message?.values ?? [];
        },
        [scope, batch]
    );

    const toggleSort = useCallback((columnId: string) => {
        setSort((prev) =>
            prev.columnId === columnId
                ? { columnId, direction: prev.direction === "asc" ? "desc" : "asc" }
                : { columnId, direction: "asc" }
        );
    }, []);

    const setFilter = useCallback((columnId: string, value: ColumnFilters[string]) => {
        setFilters((prev) => ({ ...prev, [columnId]: value }));
    }, []);

    const clearFilters = useCallback(() => setFilters({}), []);

    return {
        search,
        setSearch,
        filters,
        setFilter,
        clearFilters,
        filterCount: activeFilterCount(filters),
        sort,
        toggleSort,
        page,
        setPage,
        pageSize,
        hidden,
        setHidden,
        rows,
        total: data?.message?.total ?? 0,
        loading: Boolean(isLoading),
        tabCounts: data?.message?.tab_counts,
        statusCounts: data?.message?.status_counts,
        mutate,
        loadFacetValues,
    };
}
