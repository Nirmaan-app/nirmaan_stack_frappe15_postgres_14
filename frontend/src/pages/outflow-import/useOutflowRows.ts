// src/pages/outflow-import/useOutflowRows.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type {
    OutflowImportRow,
    OutflowRowsPage,
} from "@/types/NirmaanStack/OutflowImportBatch";

import type { DateFilterValue } from "@/components/data-table/dateFilterModel";

import {
    DEFAULT_HIDDEN_COLUMNS,
    DEFAULT_PAGE_SIZE,
    PERIOD_COLUMN_ID,
    SOURCE_COLUMN_ID,
    activeFilterCount,
    isDateFilterValue,
    serverQuery,
    type ColumnFilters,
    type OutflowScope,
    type SortState,
} from "./outflowTableModel";
import { useOutflowPeriod } from "./useOutflowPeriodStore";
import { useOutflowSource } from "./useOutflowSourceStore";

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

    /**
     * The FILTER half of this table's query — everything except the scope, the sort and the paging.
     *
     * ⚠️ IT EXISTS SO THE PANEL ABOVE THE TABLE CANNOT DESCRIBE A DIFFERENT POPULATION (slice P1).
     * `get_outflow_summary`, `get_confirmable_rows` and `match_period` all take the same filter set
     * and all build it with the same server-side `_row_filters`. Handing them this object is what
     * makes the summary literally the aggregate of the table beneath it — the reason the old
     * one-import panel and all-imports table could disagree, and the reason that ruling could be
     * revised rather than merely overridden.
     *
     * ⚠️ THE SCOPE IS EXCLUDED ON PURPOSE. The scope is the TAB — a partition OF this population,
     * not a narrowing of it — so a summary that applied it would describe whichever tab was open.
     * This is the same rule the server's `_tab_counts` follows.
     */
    filterQuery: Omit<
        ReturnType<typeof serverQuery>,
        "scope" | "sort_by" | "sort_dir" | "limit" | "offset"
    > & { facets?: Record<string, string[]> };
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
    const [ownFilters, setOwnFilters] = useState<ColumnFilters>({});
    const [sort, setSort] = useState<SortState>({ columnId: "added_on", direction: "desc" });
    const [page, setPage] = useState(0);
    const [hidden, setHidden] = useState<Set<string>>(
        () => new Set([...DEFAULT_HIDDEN_COLUMNS, ...(alsoHidden ?? [])])
    );

    /**
     * The screen's period, which is the `added_on` column's filter (slice P1).
     *
     * ⚠️ IT LIVES IN A STORE, NOT IN THIS HOOK'S STATE, AND IT HAS TO. Two instances of this hook are
     * alive at once -- the master table and the Skipped dialog's table -- and the summary panel above
     * them reads the same window. Per-instance state would let the dialog show one period while the
     * chip that opened it counted another, which is exactly the class of defect this feature has
     * already shipped once ("button 688, table 893").
     *
     * ⚠️ IT IS SURFACED AS AN ORDINARY COLUMN FILTER so `OutflowRowsTable` stays ignorant of it: the
     * header reads `filters[column.id]` and writes `onFilter(column.id, value)` for every column
     * alike, and only `setFilter` below knows this one goes somewhere else.
     */
    const { period, setPeriod } = useOutflowPeriod();

    /**
     * The screen's source scope, on exactly the same terms as the period (slice CF/S2). It is the
     * `source` column's facet, and the control above the summary is its second editor.
     */
    const { sources, setSources } = useOutflowSource();

    /**
     * ⚠️ A PINNED BATCH SUPPRESSES THE PERIOD ENTIRELY, and this is a correctness rule rather than a
     * convenience. On `/bulk-import-outflow/:id` the screen is scoped to ONE import and the period
     * control is HIDDEN — so a period left in the store by an earlier visit would keep narrowing the
     * view with nothing on screen to reveal or clear it. Live-observed before the fix: a deep link to
     * a 1,043-row statement reported 274 transfers, under a panel headed "Showing OFI-26-00289".
     *
     * An invisible filter is the worst kind: every number is wrong and everything looks right. A
     * deep link means "this import, all of it".
     *
     * ⚠️ THE SOURCE SCOPE IS WITHHELD BY THE SAME LINE, AND THAT IS ONE RULE RATHER THAN TWO (slice
     * CF/S2). A pinned import is ONE statement with ONE source, so a scope disagreeing with it does
     * not narrow the view — it empties it, and the reader is looking at a screen headed by the
     * statement they just chose reporting zero transfers. "This import, all of it" has to mean all
     * of it whichever control is left set.
     */
    const filters = useMemo<ColumnFilters>(
        () => ({
            ...ownFilters,
            [PERIOD_COLUMN_ID]: batch ? undefined : (period ?? undefined),
            [SOURCE_COLUMN_ID]: batch || !sources.length ? undefined : sources,
        }),
        [ownFilters, period, sources, batch]
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

    // Derived from the SAME `rowsQuery` the table just sent, so a sibling endpoint cannot be handed
    // a filter set the table is not showing. Stripping the scope/sort/paging keys rather than
    // rebuilding the object is what guarantees it.
    const filterQuery = useMemo(() => {
        const { scope: _s, sort_by: _b, sort_dir: _d, limit: _l, offset: _o, ...rest } = rowsQuery;
        return rest;
    }, [rowsQuery]);

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
            // ⚠️ THE PERIOD GOES TOO (slice P1). `get_outflow_facet_values` applies every filter
            // except the funnel's own, so omitting the dates would offer beneficiaries and imports
            // from OUTSIDE the window — values that select nothing once ticked, which reads as a
            // broken filter rather than as a period doing its job.
            if (query.date_from) params.set("date_from", query.date_from);
            if (query.date_to) params.set("date_to", query.date_to);

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

    /**
     * ⚠️ TWO COLUMNS ARE ROUTED TO STORES, EVERY OTHER COLUMN TO LOCAL STATE. This is the ONE place
     * that knows the `added_on` funnel and the `Period` control — and, since CF/S2, the `source`
     * funnel and the `Source` control — are each two editors of one value. Writing either into
     * `ownFilters` as well would create a second copy that `filters` then overwrites on the next
     * render: the edit would appear to work and then revert.
     */
    const setFilter = useCallback(
        (columnId: string, value: ColumnFilters[string]) => {
            if (columnId === PERIOD_COLUMN_ID) {
                setPeriod(isDateFilterValue(value) ? (value as DateFilterValue) : null);
                return;
            }
            if (columnId === SOURCE_COLUMN_ID) {
                setSources(Array.isArray(value) ? value : []);
                return;
            }
            setOwnFilters((prev) => ({ ...prev, [columnId]: value }));
        },
        [setPeriod, setSources]
    );

    /**
     * ⚠️ CLEARING TOUCHES NEITHER THE PERIOD NOR THE SOURCE, deliberately — see `activeFilterCount`,
     * which excludes both from the badge for the same reason. Each is the scope somebody chose for
     * the whole screen and each has its own always-visible control saying so; a "Clear filters"
     * button silently widening the summary to every transfer ever staged, or to a source the reader
     * had deliberately set aside, is a much bigger act than clearing a funnel.
     *
     * It falls out for free rather than needing a second exclusion: both live in stores, and this
     * only resets `ownFilters`.
     */
    const clearFilters = useCallback(() => setOwnFilters({}), []);

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
        filterQuery,
    };
}
