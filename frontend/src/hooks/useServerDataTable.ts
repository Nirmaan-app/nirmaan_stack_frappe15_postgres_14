import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    // getFilteredRowModel, // Keep for potential client-side overrides if needed later
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
import { useFrappeEventListener, useFrappePostCall, useSWRConfig } from 'frappe-react-sdk'; // Assuming you use this context provider
import { debounce } from 'lodash';
import { urlStateManager } from '@/utils/urlStateManager';
import { convertTanstackFiltersToFrappe } from '@/lib/frappeTypeUtils';

// --- Configuration ---
const DEBOUNCE_DELAY = 500; // ms


// --- Base SWR Key Prefix for this hook's data ---
// We use this to invalidate relevant queries without needing the exact parameter hash
const SWR_KEY_PREFIX = 'custom_datatable_list';

// --- URL State Synchronization ---
// Helper to safely parse URL params to numbers
export const getUrlIntParam = (key: string, defaultValue: number): number => {
    const val = urlStateManager.getParam(key);
    const num = parseInt(val || '', 10);
    return isNaN(num) || num < 0 ? defaultValue : num;
};


export const getUrlStringParam = (key: string, defaultValue: string): string => {
    return urlStateManager.getParam(key) ?? defaultValue;
};


export const getUrlJsonParam = <T>(key: string, defaultValue: T): T => {
    const val = urlStateManager.getParam(key);
    if (!val) return defaultValue;
    try {
        return JSON.parse(val);
    } catch (e) {
        console.error(`Failed to parse URL param "${key}":`, e);
        return defaultValue;
    }
};

export const getUrlBoolParam = (key: string, defaultValue: boolean): boolean => {
    const val = urlStateManager.getParam(key);
    return val ? val === 'true' : defaultValue;
};

// --- Types ---
export interface ServerDataTableConfig<TData> {
    doctype: string;
    columns: ColumnDef<TData>[];
    /** Fields to fetch from Frappe. Ensure 'name' is included if needed. */
    fetchFields: string[];
    /** Default field to search when globalSearch is disabled. */
    // defaultSearchField: string;
    globalSearchFieldList?: string[]; // For global search
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

    additionalFilters?: any[] // Keep this for static  filters
    // --- NEW ---
    /** Should the Item Search option be available for this table? */
    enableItemSearch?: boolean;
    // -----------
    // --- NEW ---
    /** If true, filters results to only include docs where specific JSON conditions are met (backend logic) */
    requirePendingItems?: boolean; // Example specific flag for PRs
    // -----------
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
    // isGlobalSearchEnabled: boolean;
    // toggleGlobalSearch: () => void;
    refetch: () => void; // Function to manually trigger data refetch
    // --- NEW ---
    isItemSearchEnabled: boolean;
    toggleItemSearch: () => void;
    showItemSearchToggle: boolean; // Expose whether the toggle should be shown
    // -----------
}


// --- Helper: Base64 encode/decode for URL safety ---
const encodeFiltersForUrl = (filters: ColumnFiltersState): string | null => {
    if (!filters || filters.length === 0) return null;
    try {
        const jsonString = JSON.stringify(filters);
        return btoa(jsonString); // Base64 encode
    } catch (e) {
        console.error("Failed to encode filters:", e);
        return null;
    }
};

const decodeFiltersFromUrl = (encodedString: string | null): ColumnFiltersState => {
    if (!encodedString) return [];
    try {
        const jsonString = atob(encodedString); // Base64 decode
        const parsed = JSON.parse(jsonString);
        // Basic validation: is it an array? are items objects with id/value?
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'object' && item !== null && 'id' in item && 'value' in item)) {
             // Further validation could be added for specific value types if needed
            return parsed as ColumnFiltersState;
        }
        console.warn("Decoded filter string is not a valid ColumnFiltersState:", parsed);
        return [];
    } catch (e) {
        console.error("Failed to decode/parse filters from URL:", e);
        return [];
    }
};


// --- The Hook ---
export function useServerDataTable<TData extends { name: string }>({
    doctype,
    columns,
    fetchFields,
    // defaultSearchField,
    globalSearchFieldList = [], // This is used to populate current_search_fields for global search
    additionalFilters = [],

    initialState = {},
    enableRowSelection = false,
    onRowSelectionChange,
    defaultSort = 'creation desc',
    urlSyncKey,
    // --- NEW ---
    enableItemSearch = false, // Default to false
    // -----------
    requirePendingItems = false, // Default to false
}: ServerDataTableConfig<TData>): ServerDataTableResult<TData> {

    // const { call, loading: isLoading } = useFrappePostCall<{message: { data: TData[]; total_count: number } }>("nirmaan_stack.api.data-table.get_list_with_count_via_reportview_logic"); // Get Frappe call method from context


    const apiEndpoint = 'nirmaan_stack.api.data-table.get_list_with_count_enhanced'; // Get Frappe call method from context
    const { call: triggerFetch, loading: isCallingApi, error: apiError, reset: resetApiState } = useFrappePostCall<{message: { data: TData[]; total_count: number } }>(apiEndpoint); // Get Frappe call method from context

    // --- SWR Mutate for Cache Invalidation ---
    const { mutate } = useSWRConfig();
    // -----------------------------------------

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


    // --- MODIFIED: Initialize columnFilters from single URL param ---
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
        if (urlSyncKey) {
            const encodedFilters = urlStateManager.getParam(`${urlSyncKey}_filters`); // Use single key
            const decoded = decodeFiltersFromUrl(encodedFilters);
            return decoded.length > 0 ? decoded : (initialState.columnFilters ?? []);
        }
        return initialState.columnFilters ?? [];
    });
    // --- END MODIFICATION ---

    // console.log("columnFilters FROM HOOK:", columnFilters); // Good for debugging

    const [globalFilter, setGlobalFilter] = useState<string>(() =>
        urlSyncKey
            ? getUrlStringParam(`${urlSyncKey}_search`, initialState.globalFilter ?? '')
            : (initialState.globalFilter ?? '')
    );

    // State for the search term that *actually* triggers the API call (after debounce)
    const [debouncedSearchTermForApi, setDebouncedSearchTermForApi] = useState<string>(globalFilter);

    // --- NEW: State for Item Search ---
    const [isItemSearchEnabled, setIsItemSearchEnabled] = useState<boolean>(() =>
        enableItemSearch && urlSyncKey // Only read from URL if item search is enabled for this table
            ? getUrlBoolParam(`${urlSyncKey}_itemSearch`, false) // Default item search to false
            : false
    );
    // ---------------------------------


    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialState.columnVisibility ?? {});
    const [rowSelection, setRowSelection] = useState<RowSelectionState>(initialState.rowSelection ?? {});

    const [data, setData] = useState<TData[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [error, setError] = useState<Error | null>(null);
    const [isLoading, setIsLoading] = useState(false); // Manual loading state
    const [internalTrigger, setInternalTrigger] = useState<number>(0); // To manually refetch

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
        //   urlStateManager.subscribe(`${keyPrefix}globalSearch`, (_, value) => setIsGlobalSearchEnabled(value === 'true')),
          urlStateManager.subscribe(`${keyPrefix}sort`, (_, value) => { try { setSorting(value ? JSON.parse(value) : []) } catch { setSorting([]) } }),

          // --- NEW: Sync item search state from URL ---
          ...(enableItemSearch ? [urlStateManager.subscribe(`${keyPrefix}itemSearch`, (_, value) => setIsItemSearchEnabled(value === 'true'))] : []),
          // ------------------------------------------
        //   urlStateManager.subscribe(`${keyPrefix}filters`, (_, value) => { try { setColumnFilters(value ? JSON.parse(value) : []) } catch { setColumnFilters([]) } }),

        // --- MODIFIED: Subscribe to the single encoded filters param ---
        urlStateManager.subscribe(`${keyPrefix}filters`, (_, value) => {
            // Update state only if decoded value differs from current state JSON stringified
            const decoded = decodeFiltersFromUrl(value);
            if(JSON.stringify(columnFilters) !== JSON.stringify(decoded)) {
                 console.log("Updating columnFilters state from URL subscription");
                 setColumnFilters(decoded);
            }
        }),
        // --- END MODIFICATION ---
      ];
      // Return cleanup function to unsubscribe all
      return () => subscriptions.forEach(unsub => unsub());
  }, [urlSyncKey, enableItemSearch, columnFilters]); // Add columnFilters here to compare on popstate update


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
    // useEffect(() => updateUrlParam('globalSearch', isGlobalSearchEnabled ? 'true' : 'false'), [isGlobalSearchEnabled, updateUrlParam]);
    useEffect(() => updateUrlParam('sort', sorting.length ? JSON.stringify(sorting) : null), [sorting, updateUrlParam]);
    // useEffect(() => updateUrlParam('filters', columnFilters.length ? JSON.stringify(columnFilters) : null), [columnFilters, updateUrlParam]);

    // --- NEW: Sync item search TO URL ---
    useEffect(() => {
        if(enableItemSearch && urlSyncKey) {
             updateUrlParam('itemSearch', isItemSearchEnabled ? 'true' : null); // Use null to remove param
        }
    }, [isItemSearchEnabled, enableItemSearch, urlSyncKey, updateUrlParam]);

    // --- MODIFIED: Sync entire columnFilters state TO single URL param ---
    useEffect(() => {
        if (urlSyncKey) {
             const encodedFilters = encodeFiltersForUrl(columnFilters);
            updateUrlParam('filters', encodedFilters); // Use single key "_filters"
        }
    }, [columnFilters, urlSyncKey, updateUrlParam]);
    // --- END MODIFICATION ---


    // --- Data Fetching ---
    // Use useRef to prevent fetching on initial mount if desired, or manage initial fetch state.
    const isInitialMount = useRef(true);
    
    const fetchData = useCallback(async (isRefetch = false) => {
        // Don't fetch if already loading, unless it's a manual refetch trigger
        if (isLoading && !isRefetch) return;
        
        setIsLoading(true); // Set loading true when fetch starts
        setError(null); // Clear previous error
        resetApiState(); // Reset error/completion state of useFrappePostCall

        // --- Parameter preparation for YOUR backend API ---
        const orderByForApi = sorting.length > 0
            ? `${sorting[0].id} ${sorting[0].desc ? 'desc' : 'asc'}`
            : defaultSort; // Send simple field name, backend can prefix if needed for reportview

        // --- FIX TypeScript Errors ---
        // Call convertTanstackFiltersToFrappe with only one argument
        const tanstackGeneratedFilters = convertTanstackFiltersToFrappe(columnFilters);

        let combinedBaseFilters = [...additionalFilters];
        // Ensure tanstackGeneratedFilters is an array before spreading
        if (Array.isArray(tanstackGeneratedFilters) && tanstackGeneratedFilters.length > 0) {
            combinedBaseFilters.push(...tanstackGeneratedFilters);
        }
        // --- END FIX ---


        const searchTermForApi = debouncedSearchTermForApi;

        // --- MODIFIED: Determine params based on item search ---
        let fieldsForBackendSearch: string[] | undefined = undefined;
        if (!isItemSearchEnabled && searchTermForApi) {
            // Default is global search, use the provided list
            fieldsForBackendSearch = globalSearchFieldList;
        }
        // If isItemSearchEnabled is true, backend handles it, no need to send search fields list

        const payload = {
            doctype: doctype,
            fields: JSON.stringify(fetchFields),
            filters: JSON.stringify(combinedBaseFilters.length > 0 ? combinedBaseFilters : []),
            order_by: orderByForApi,
            limit_start: pagination.pageIndex * pagination.pageSize,
            limit_page_length: pagination.pageSize,
            search_term: searchTermForApi || undefined,
            // --- NEW: Pass consolidated search params ---
            // current_search_fields: searchFieldsForBackend ? JSON.stringify(searchFieldsForBackend) : undefined,
            // is_global_search: isGlobalSearchEnabled,
            // -------------------------------------------
            current_search_fields: fieldsForBackendSearch ? JSON.stringify(fieldsForBackendSearch) : undefined,
            is_item_search: isItemSearchEnabled, // Pass the new flag
            // --- NEW: Pass the new flag ---
            require_pending_items: requirePendingItems,
            // -----------------------------
        };

        // --- Define the SWR Key for THIS specific fetch ---
        // Needs to include all params that affect the result
        const currentQueryKey = [
            SWR_KEY_PREFIX,
            apiEndpoint,
            JSON.stringify(payload) // Key based on exact payload
           ];

        // console.log("[useServerDataTable calling custom backend adapter] Payload:", payload);

        try {
            const response = await triggerFetch(payload);
            if (response.message) {
                setData(response.message.data);
                setTotalCount(response.message.total_count);
                // Update SWR cache manually after successful fetch if needed elsewhere?
                // mutate(currentQueryKey, response, false); // Update cache without revalidation
            } else {
                console.warn('Custom API call successful but no message received.');
                setData([]); setTotalCount(0);
            }
        } catch (err: any) {
            console.error("Error fetching data via custom backend adapter:", err);
            const errorMessage = err.message || (err._server_messages ? JSON.parse(err._server_messages)[0].message : 'An unknown error occurred');
            setError(err instanceof Error ? err : new Error(errorMessage));
            setData([]); setTotalCount(0);
        } finally {
            setIsLoading(false); // Set loading false when fetch completes
        }
    }, [
        triggerFetch,resetApiState, apiEndpoint, doctype, JSON.stringify(fetchFields),
        pagination.pageIndex, pagination.pageSize, JSON.stringify(sorting),
        JSON.stringify(columnFilters), debouncedSearchTermForApi, 
        // isGlobalSearchEnabled,
        // defaultSearchField, 
        isItemSearchEnabled,
        JSON.stringify(globalSearchFieldList), defaultSort,
        JSON.stringify(additionalFilters), internalTrigger, // Added additionalFilters
        requirePendingItems
    ]);

   // Effect to trigger data fetching when dependencies change
   useEffect(() => {
    // Optional: Prevent fetch on initial mount if you have initial data or want manual trigger first
    if (isInitialMount.current) {
        isInitialMount.current = false;
        // If you have initial state derived from URL, you might *want* the initial fetch
        // Decide based on your desired behavior.
        // return;

        // Fetch initial data if columnFilters (from URL) or other params are set
        if (columnFilters.length > 0 || globalFilter || sorting.length > 0 || !urlSyncKey) {
            fetchData();
        } 
        return;
    }

    fetchData();
}, [fetchData]); // Dependency is the memoized fetchData function

    // --- Real-time Event Listener using useFrappeEventListener ---
    const handleRealtimeEvent = useCallback((message: any) => {
        console.log(`[useServerDataTable ${doctype}] Socket event received:`, message?.event, message);
        // Check if the event is relevant to the current doctype
        if (message?.doctype === doctype) {
            console.log(`[useServerDataTable ${doctype}] Relevant event received. Invalidating cache and refetching.`);
        
            // --- SWR Cache Invalidation ---
            // Invalidate based on a prefix to catch all variations of filters/pagination for this list
            // This tells SWR to mark data starting with this key pattern as stale.
            // The second argument `false` means don't refetch immediately IF the hook isn't mounted/visible.
            // SWR will revalidate automatically on focus or mount if data is stale.
            // We might still want an immediate refetch if the table *is* visible.
            mutate(
                (key) => Array.isArray(key) && key[0] === SWR_KEY_PREFIX && key[1] === apiEndpoint && key[2]?.includes(`"doctype":"${doctype}"`), // More precise invalidation if needed
                undefined, // Setting data to undefined forces refetch on next render/focus
                { revalidate: true } // Trigger revalidation (refetch) immediately if component is mounted
            );
        
            // OR a simpler invalidation (might be less precise but often works):
            // mutate(key => Array.isArray(key) && key[0] === SWR_KEY_PREFIX && key[1] === apiEndpoint, undefined, { revalidate: true });
        
            // Since we manage data with useState now, we might need to directly trigger fetchData
            fetchData(true); // Call fetchData directly to update our local state
        }
    }, [doctype, apiEndpoint, mutate, fetchData]); // Add fetchData to deps
    
    // Subscribe to doctype-specific events
    useFrappeEventListener(`po:new`, handleRealtimeEvent);
    useFrappeEventListener(`po:updated`, handleRealtimeEvent);
    useFrappeEventListener(`po:status_changed`, handleRealtimeEvent);
    useFrappeEventListener(`po:deleted`, handleRealtimeEvent);
    useFrappeEventListener(`po:cancelled`, handleRealtimeEvent);
    // Optionally listen to generic Frappe events (can be noisy)
    // useFrappeEventListener(`list_update`, handleRealtimeEvent);

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
        // getFilteredRowModel: getFilteredRowModel(), // Might not be strictly needed for server-side
        getFacetedRowModel: getFacetedRowModel(), // Useful for faceted filter UI options
        getFacetedUniqueValues: getFacetedUniqueValues(), // Useful for faceted filter UI options
        // Configuration
        enableRowSelection: enableRowSelection,
        // debugTable: process.env.NODE_ENV === 'development', // Enable debugging in dev
    });

    // NEW: Toggle Item Search
    const toggleItemSearch = useCallback(() => {
        if (!enableItemSearch) return; // Do nothing if not enabled for this table
        setIsItemSearchEnabled(prev => {
             const newState = !prev;
             // Reset pagination and potentially search term when toggling search type
             setGlobalFilter('');
             setDebouncedSearchTermForApi('');
             setPagination(p => ({ ...p, pageIndex: 0 }));
             return newState;
        });
      }, [enableItemSearch]); // Depend on enableItemSearch

    // --- MODIFIED: Refetch function ---
    const refetch = useCallback(() => {
        console.log(`[useServerDataTable ${doctype}] Manual refetch triggered.`);
        // Invalidate cache first
        mutate(key => Array.isArray(key) && key[0] === SWR_KEY_PREFIX && key[1] === apiEndpoint, undefined, { revalidate: false }); // Invalidate, don't auto-refetch yet
        // Trigger internal state change OR direct fetch
        // setInternalTrigger(count => count + 1); // This will trigger the useEffect [fetchData]
        fetchData(true); // Or call directly, passing true to bypass loading check
    }, [mutate, apiEndpoint, fetchData]); // Added fetchData
    // -----------------------------------


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
        // isGlobalSearchEnabled,
        // toggleGlobalSearch,
        isItemSearchEnabled, 
        toggleItemSearch, // Add new item search state/toggle
        showItemSearchToggle: enableItemSearch, // Indicate if toggle should be shown
        refetch,
    };
}