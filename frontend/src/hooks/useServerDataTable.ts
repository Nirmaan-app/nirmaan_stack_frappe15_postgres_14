import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel, // Keep for potential client-side overrides if needed later
    getFacetedRowModel, // Keep for UI helpers like unique values
    getFacetedUniqueValues, // Keep for UI helpers
    ColumnDef,
    SortingState,
    PaginationState,
    ColumnFiltersState,
    VisibilityState,
    Table, // Import Table type
    RowSelectionState,
    Row,
} from '@tanstack/react-table';
import { useFrappePostCall } from 'frappe-react-sdk'; // Assuming you use this context provider
import { debounce } from 'lodash';
import { urlStateManager } from '@/utils/urlStateManager';
import { convertTanstackFiltersToFrappe } from '@/lib/frappeTypeUtils';

// --- Configuration ---
const DEBOUNCE_DELAY = 500; // ms

// --- Types ---
export interface ServerDataTableConfig<TData> {
    doctype: string;
    columns: ColumnDef<TData>[];
    /** Fields to fetch from Frappe. Ensure 'name' is included if needed. */
    fetchFields: string[];
    /** Default field to search when globalSearch is disabled. */
    defaultSearchField: string;
    /** Optional initial state overrides */
    initialState?: {
        sorting?: SortingState;
        columnFilters?: ColumnFiltersState; // For initial URL load potentially
        pagination?: PaginationState;
        globalFilter?: string;
        isGlobalSearchEnabled?: boolean;
        columnVisibility?: VisibilityState;
        rowSelection?: RowSelectionState;
    };
    /** Enable row selection */
    enableRowSelection?: boolean | ((row: Row<TData>) => boolean); // Allow function type
    /** Hook for row selection changes */
    onRowSelectionChange?: (updater: React.SetStateAction<RowSelectionState>) => void;
     /** Optional Frappe orderBy string (e.g., "creation desc") */
    defaultSort?: string;
    /** Key for storing/retrieving state in URL. If not provided, URL sync is disabled */
    urlSyncKey?: string;
}

export interface ServerDataTableResult<TData> {
    table: Table<TData>;
    data: TData[];
    totalCount: number;
    isLoading: boolean;
    error: Error | null;
    // State values & setters directly exposed for more control if needed
    pagination: PaginationState;
    setPagination: React.Dispatch<React.SetStateAction<PaginationState>>;
    sorting: SortingState;
    setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
    columnFilters: ColumnFiltersState;
    setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
    globalFilter: string;
    setGlobalFilter: React.Dispatch<React.SetStateAction<string>>;
    isGlobalSearchEnabled: boolean;
    toggleGlobalSearch: () => void;
    refetch: () => void; // Function to manually trigger data refetch
}

// --- The Hook ---
export function useServerDataTable<TData extends { name: string }>({
    doctype,
    columns,
    fetchFields,
    defaultSearchField,
    initialState = {},
    enableRowSelection = false,
    onRowSelectionChange,
    defaultSort = 'creation desc',
    urlSyncKey,
}: ServerDataTableConfig<TData>): ServerDataTableResult<TData> {

    const { call, loading: isLoading } = useFrappePostCall<{message: { data: TData[]; total_count: number } }>("nirmaan_stack.api.data-table.get_list_with_count"); // Get Frappe call method from context

    // --- URL State Synchronization ---
    // Helper to safely parse URL params to numbers
    const getUrlIntParam = (key: string, defaultValue: number): number => {
        const val = urlStateManager.getParam(key);
        const num = parseInt(val || '', 10);
        return isNaN(num) || num < 0 ? defaultValue : num;
    };

    const getUrlStringParam = (key: string, defaultValue: string): string => {
        return urlStateManager.getParam(key) ?? defaultValue;
    };

    const getUrlJsonParam = <T>(key: string, defaultValue: T): T => {
        const val = urlStateManager.getParam(key);
        if (!val) return defaultValue;
        try {
            return JSON.parse(val);
        } catch (e) {
            console.error(`Failed to parse URL param "${key}":`, e);
            return defaultValue;
        }
    };

    const getUrlBoolParam = (key: string, defaultValue: boolean): boolean => {
        const val = urlStateManager.getParam(key);
        return val ? val === 'true' : defaultValue;
    };

    // --- State Management ---
    const [pagination, setPagination] = useState<PaginationState>(() => ({
        pageIndex: urlSyncKey ? getUrlIntParam(`${urlSyncKey}_pageIdx`, 0) : (initialState.pagination?.pageIndex ?? 0),
        pageSize: urlSyncKey ? getUrlIntParam(`${urlSyncKey}_pageSize`, 10) : (initialState.pagination?.pageSize ?? 10),
    }));

    const [sorting, setSorting] = useState<SortingState>(() =>
        urlSyncKey
            ? getUrlJsonParam<SortingState>(`${urlSyncKey}_sort`, initialState.sorting ?? [])
            : (initialState.sorting ?? [])
    );

    // Column filters are primarily driven by URL params for faceted filters
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
        urlSyncKey
            ? getUrlJsonParam<ColumnFiltersState>(`${urlSyncKey}_filters`, initialState.columnFilters ?? [])
            : (initialState.columnFilters ?? [])
    );

    const [globalFilter, setGlobalFilter] = useState<string>(() =>
        urlSyncKey
            ? getUrlStringParam(`${urlSyncKey}_search`, initialState.globalFilter ?? '')
            : (initialState.globalFilter ?? '')
    );

    // State for the search term that *actually* triggers the API call (after debounce)
    const [debouncedSearchTermForApi, setDebouncedSearchTermForApi] = useState<string>(globalFilter);


    const [isGlobalSearchEnabled, setIsGlobalSearchEnabled] = useState<boolean>(() =>
        urlSyncKey
            ? getUrlBoolParam(`${urlSyncKey}_globalSearch`, initialState.isGlobalSearchEnabled ?? false)
            : (initialState.isGlobalSearchEnabled ?? false)
    );

    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialState.columnVisibility ?? {});
    const [rowSelection, setRowSelection] = useState<RowSelectionState>(initialState.rowSelection ?? {});

    const [data, setData] = useState<TData[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [error, setError] = useState<Error | null>(null);
    const [internalTrigger, setInternalTrigger] = useState<number>(0); // To manually refetch

    // Debounce global filter input
    // const [debouncedGlobalFilter] = debounce(globalFilter, DEBOUNCE_DELAY);

    // --- Debounce Logic using lodash.debounce ---
    // Create a debounced function that updates the API search term state.
    // Use useMemo to ensure the debounced function is stable unless DEBOUNCE_DELAY changes.
    const debouncedSetApiSearchTerm = useMemo(
      () => debounce(
          (value: string) => {
              setDebouncedSearchTermForApi(value);
              // Reset to first page when search term changes
              setPagination(p => ({ ...p, pageIndex: 0 }));
          },
          DEBOUNCE_DELAY
      ),
      [DEBOUNCE_DELAY] // Only recreate if delay changes
  );

  // Effect to call the debounced function when the *immediate* globalFilter changes
  useEffect(() => {
    debouncedSetApiSearchTerm(globalFilter);

    // Cleanup function to cancel any pending debounced calls if the component unmounts
    // or if globalFilter changes again before the delay expires.
    return () => {
        debouncedSetApiSearchTerm.cancel();
    };
}, [globalFilter, debouncedSetApiSearchTerm]);

    // --- URL Sync Effects ---
    // useEffect(() => {
    //     if (!urlSyncKey) return;
    //     const subscriptions = [
    //         urlStateManager.subscribe(`${urlSyncKey}_pageIdx`, (_, value) => setPagination(p => ({ ...p, pageIndex: parseInt(value || '0', 10) }))),
    //         urlStateManager.subscribe(`${urlSyncKey}_pageSize`, (_, value) => setPagination(p => ({ ...p, pageIndex: 0, pageSize: parseInt(value || '10', 10) }))), // Reset page index on size change
    //         urlStateManager.subscribe(`${urlSyncKey}_search`, (_, value) => setGlobalFilter(value || '')),
    //         urlStateManager.subscribe(`${urlSyncKey}_globalSearch`, (_, value) => setIsGlobalSearchEnabled(value === 'true')),
    //         urlStateManager.subscribe(`${urlSyncKey}_sort`, (_, value) => setSorting(value ? JSON.parse(value) : [])),
    //         urlStateManager.subscribe(`${urlSyncKey}_filters`, (_, value) => setColumnFilters(value ? JSON.parse(value) : [])),
    //     ];
    //     return () => subscriptions.forEach(unsub => unsub());
    // }, [urlSyncKey]);


    // Subscribe to URL changes and update local state
    useEffect(() => {
      if (!urlSyncKey) return;
      const keyPrefix = `${urlSyncKey}_`;
      const subscriptions = [
          urlStateManager.subscribe(`${keyPrefix}pageIdx`, (_, value) => setPagination(p => ({ ...p, pageIndex: parseInt(value || '0', 10) }))),
          urlStateManager.subscribe(`${keyPrefix}pageSize`, (_, value) => {
              const newSize = parseInt(value || '10', 10);
               // Ensure page size is valid, default to 10 if not
               const validSize = newSize > 0 ? newSize : 10;
              setPagination(p => ({ ...p, pageIndex: 0, pageSize: validSize })); // Reset page index
          }),
          urlStateManager.subscribe(`${keyPrefix}search`, (_, value) => setGlobalFilter(value ?? '')), // Update immediate filter
          urlStateManager.subscribe(`${keyPrefix}globalSearch`, (_, value) => setIsGlobalSearchEnabled(value === 'true')),
          urlStateManager.subscribe(`${keyPrefix}sort`, (_, value) => { try { setSorting(value ? JSON.parse(value) : []) } catch { setSorting([]) } }),
          urlStateManager.subscribe(`${keyPrefix}filters`, (_, value) => { try { setColumnFilters(value ? JSON.parse(value) : []) } catch { setColumnFilters([]) } }),
      ];
      // Return cleanup function to unsubscribe all
      return () => subscriptions.forEach(unsub => unsub());
  }, [urlSyncKey]); // Re-run only if urlSyncKey changes


    // Update URL when local state changes (avoiding infinite loops)
    const updateUrlParam = useCallback((key: string, value: string | null) => {
        if (urlSyncKey) {
            const fullKey = `${urlSyncKey}_${key}`;
            if (urlStateManager.getParam(fullKey) !== value) { // Only update if changed
                urlStateManager.updateParam(fullKey, value);
            }
        }
    }, [urlSyncKey]);

    useEffect(() => updateUrlParam('pageIdx', pagination.pageIndex.toString()), [pagination.pageIndex, updateUrlParam]);
    useEffect(() => updateUrlParam('pageSize', pagination.pageSize.toString()), [pagination.pageSize, updateUrlParam]);
    useEffect(() => updateUrlParam('search', globalFilter || null), [globalFilter, updateUrlParam]); // Use debounced? No, reflect input immediately, debounce fetch
    useEffect(() => updateUrlParam('globalSearch', isGlobalSearchEnabled ? 'true' : 'false'), [isGlobalSearchEnabled, updateUrlParam]);
    useEffect(() => updateUrlParam('sort', sorting.length ? JSON.stringify(sorting) : null), [sorting, updateUrlParam]);
    useEffect(() => updateUrlParam('filters', columnFilters.length ? JSON.stringify(columnFilters) : null), [columnFilters, updateUrlParam]);


    // --- Data Fetching ---
    // Use useRef to prevent fetching on initial mount if desired, or manage initial fetch state.
    const isInitialMount = useRef(true);
    // --- Data Fetching ---
    const fetchData = useCallback(async () => {
        setError(null);

        // 1. Convert TanStack SortingState to Frappe order_by string
        const orderBy = sorting.length > 0
            ? `${sorting[0].id} ${sorting[0].desc ? 'desc' : 'asc'}`
            : defaultSort; // Use default sort if none active

        // 2. Convert TanStack ColumnFiltersState to Frappe filters list/dict
        // This needs a helper function `convertTanstackFiltersToFrappe` (see below)
        const frappeFilters = convertTanstackFiltersToFrappe(columnFilters);

        // 3. Determine search fields based on global search toggle
        // const searchFields = !isGlobalSearchEnabled && debouncedGlobalFilter ? [defaultSearchField] : undefined;

        // Use the debounced search term for the API call
        const searchTermForApi = debouncedSearchTermForApi;

        const searchFields = !isGlobalSearchEnabled && searchTermForApi // Check debounced term
            ? [defaultSearchField]
            : undefined;

            console.log("doctype", doctype)
            console.log("fetchFields", fetchFields)
            console.log("frappeFilters", frappeFilters)
            console.log("ordeby", orderBy)
            console.log("pagination", pagination)
            console.log("searchTermForApi", searchTermForApi)
            console.log("searchFields", searchFields)
            console.log("isGlobalSearchEnabled", isGlobalSearchEnabled)
        // < { data: TData[], total_count: number } >
        try {
            const response = await call(
                // 'your_custom_app_name.api.data_table.get_list_with_count', // Correct path to your API method
                {
                    doctype: doctype,
                    fields: JSON.stringify(fetchFields), // Send as JSON string
                    filters: JSON.stringify(frappeFilters), // Send filters as JSON string
                    limit_start: pagination.pageIndex * pagination.pageSize,
                    limit_page_length: pagination.pageSize,
                    order_by: orderBy,
                    search_term: searchTermForApi || undefined, // Send debounced search term
                    search_fields: searchFields ? JSON.stringify(searchFields) : undefined, // Send as JSON string if defined
                    global_search: isGlobalSearchEnabled,
                }
            );

            if (response.message) {
                setData(response.message.data);
                setTotalCount(response.message.total_count);
            } else {
                // Handle cases where Frappe might return success but no message
                console.warn('API call successful but no message received.');
                setData([]);
                setTotalCount(0);
            }
        } catch (err: any) {
            console.error("Error fetching data:", err);
            setError(err instanceof Error ? err : new Error('An unknown error occurred'));
            setData([]); // Clear data on error
            setTotalCount(0);
        }
    }, [
        call,
        doctype,
        // fetchFields,
        pagination.pageIndex,
        pagination.pageSize,
        sorting,
        columnFilters, // Reacts to changes in column filters from URL
        // debouncedGlobalFilter, // Reacts *only* to debounced search term
        debouncedSearchTermForApi,
        isGlobalSearchEnabled,
        defaultSearchField,
        defaultSort,
        internalTrigger, // Reacts to manual refetch trigger
    ]);

    // Effect to trigger data fetching when relevant dependencies change
   // Effect to trigger data fetching when dependencies change
   useEffect(() => {
    // Optional: Prevent fetch on initial mount if you have initial data or want manual trigger first
    if (isInitialMount.current) {
        isInitialMount.current = false;
        // If you have initial state derived from URL, you might *want* the initial fetch
        // Decide based on your desired behavior.
        // return;
    }

    fetchData();
}, [fetchData]); // Dependency is the memoized fetchData function

    // --- TanStack Table Instance ---
    const table = useReactTable<TData>({
        data,
        columns,
        // Manual server-side operations
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true, // We handle filtering via API call
        // Page count calculation
        pageCount: Math.ceil(totalCount / pagination.pageSize),
        // State managed by the hook
        state: {
            pagination,
            sorting,
            columnFilters, // Still needed for TanStack's internal state if using its filter components
            globalFilter, // Reflect current input value
            columnVisibility,
            rowSelection,
        },
        // State Setters -> Update hook state (which then updates URL & triggers fetch)
        onPaginationChange: setPagination,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters, // Update local state, URL effect handles sync
        onGlobalFilterChange: setGlobalFilter, // Update local state immediately for input field
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: onRowSelectionChange ?? setRowSelection, // Use passed handler or internal one
        // Models (keep faceted utils for potential UI helpers)
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(), // Might not be strictly needed for server-side
        getFacetedRowModel: getFacetedRowModel(), // Useful for faceted filter UI options
        getFacetedUniqueValues: getFacetedUniqueValues(), // Useful for faceted filter UI options
        // Configuration
        enableRowSelection: enableRowSelection,
        debugTable: process.env.NODE_ENV === 'development', // Enable debugging in dev
    });

    // --- Helper Functions ---
    // const toggleGlobalSearch = useCallback(() => {
    //     setIsGlobalSearchEnabled(prev => !prev);
    //     // Optional: Reset page index when search type changes?
    //     // setPagination(p => ({ ...p, pageIndex: 0 }));
    // }, []);

     // --- Helper Functions ---
     const toggleGlobalSearch = useCallback(() => {
      setIsGlobalSearchEnabled(prev => {
           const newState = !prev;
           // Reset search term and page index when toggling global search type? Optional.
           setGlobalFilter('');
           setDebouncedSearchTermForApi('');
           setPagination(p => ({ ...p, pageIndex: 0 }));
           return newState;
      });
  }, []);

  const refetch = useCallback(() => {
    // console.log("Manual refetch triggered"); // Debug
    setInternalTrigger(count => count + 1); // Increment trigger to refetch via fetchData dependency
}, []);


    // --- Return Value ---
    return {
        table,
        data,
        totalCount,
        isLoading,
        error,
        // Expose states and setters
        pagination,
        setPagination,
        sorting,
        setSorting,
        columnFilters,
        setColumnFilters,
        globalFilter,
        setGlobalFilter,
        isGlobalSearchEnabled,
        toggleGlobalSearch,
        refetch,
    };
}