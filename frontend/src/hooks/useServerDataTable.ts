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
}: ServerDataTableConfig<TData>): ServerDataTableResult<TData> {

    // const { call, loading: isLoading } = useFrappePostCall<{message: { data: TData[]; total_count: number } }>("nirmaan_stack.api.data-table.get_list_with_count_via_reportview_logic"); // Get Frappe call method from context

    const { call, loading: isLoading } = useFrappePostCall<{message: { data: TData[]; total_count: number } }>("nirmaan_stack.api.data-table.get_list_with_count_enhanced"); // Get Frappe call method from context

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

    // --- MODIFIED: How columnFilters are initialized and synced ---
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
        if (urlSyncKey) {
            // Read each potential column filter from URL
            // Example: po_project=VAL1,VAL2 -> { id: "project", value: ["VAL1", "VAL2"] }
            const initialFilters: ColumnFiltersState = [];
            const params = new URLSearchParams(window.location.search);
            columns.forEach(col => {
                if (col?.accessorKey) {
                    const urlParamValue = params.get(`${urlSyncKey}_${col?.accessorKey}`);
                    if (urlParamValue) {
                        initialFilters.push({ id: col?.accessorKey, value: urlParamValue.split(',') });
                    }
                }
            });
            return initialFilters.length > 0 ? initialFilters : (initialState.columnFilters ?? []);
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


    // const [isGlobalSearchEnabled, setIsGlobalSearchEnabled] = useState<boolean>(() =>
    //     urlSyncKey
    //         ? getUrlBoolParam(`${urlSyncKey}_globalSearch`, initialState.isGlobalSearchEnabled ?? false)
    //         : (initialState.isGlobalSearchEnabled ?? false)
    // );

    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialState.columnVisibility ?? {});
    const [rowSelection, setRowSelection] = useState<RowSelectionState>(initialState.rowSelection ?? {});

    const [data, setData] = useState<TData[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [error, setError] = useState<Error | null>(null);
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
    // useEffect(() => updateUrlParam('globalSearch', isGlobalSearchEnabled ? 'true' : 'false'), [isGlobalSearchEnabled, updateUrlParam]);
    useEffect(() => updateUrlParam('sort', sorting.length ? JSON.stringify(sorting) : null), [sorting, updateUrlParam]);
    // useEffect(() => updateUrlParam('filters', columnFilters.length ? JSON.stringify(columnFilters) : null), [columnFilters, updateUrlParam]);

    // --- NEW: Sync item search TO URL ---
    useEffect(() => {
        if(enableItemSearch && urlSyncKey) {
             updateUrlParam('itemSearch', isItemSearchEnabled ? 'true' : null); // Use null to remove param
        }
    }, [isItemSearchEnabled, enableItemSearch, urlSyncKey, updateUrlParam]);

    // --- NEW: Effect to sync columnFilters TO URL ---
    useEffect(() => {
        if (!urlSyncKey) return;

        // Clear old column filter params first to handle deselection
        const params = new URLSearchParams(window.location.search);
        columns.forEach(colDef => { // Iterate over defined columns to know which params to clear
            if (colDef.accessorKey) {
                params.delete(`${urlSyncKey}_${colDef.accessorKey}`);
            }
        });
        let currentSearch = params.toString();
        const newUrl = `${window.location.pathname}${currentSearch ? `?${currentSearch}` : ''}`;
        window.history.replaceState({}, '', newUrl); // Update URL after clearing


        // Set new column filter params
        if (columnFilters.length > 0) {
            columnFilters.forEach(filter => {
                if (Array.isArray(filter.value) && filter.value.length > 0) {
                    updateUrlParam(filter.id, filter.value.join(','));
                } else if (typeof filter.value === 'string' && filter.value) {
                    updateUrlParam(filter.id, filter.value);
                } else {
                     // If filter value is empty/undefined, ensure it's removed from URL by passing null
                    updateUrlParam(filter.id, null);
                }
            });
        }
        // If columnFilters is empty, all relevant params should have been cleared above
        // or by updateUrlParam(key, null)
    }, [columnFilters, urlSyncKey, updateUrlParam, columns]); // Added columns to dependency
    // --- END NEW ---


    // --- Data Fetching ---
    // Use useRef to prevent fetching on initial mount if desired, or manage initial fetch state.
    const isInitialMount = useRef(true);
    
    const fetchData = useCallback(async () => {
        setError(null);

        // --- Parameter preparation for YOUR backend API ---
        const orderByForApi = sorting.length > 0
            ? `${sorting[0].id} ${sorting[0].desc ? 'desc' : 'asc'}`
            : defaultSort; // Send simple field name, backend can prefix if needed for reportview

        // const baseFrappeFilters = convertTanstackFiltersToFrappe(columnFilters, doctype); // Pass doctype for context if needed by converter
        
        // // Combine baseFrappeFilters with additionalFilters from config
        // let combinedBaseFilters = [...additionalFilters];
        // if (baseFrappeFilters && baseFrappeFilters.length > 0) {
        //     combinedBaseFilters.push(...baseFrappeFilters);
        // }

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
        
        // --- NEW: Determine current_search_fields to send to backend ---
        // let searchFieldsForBackend: string[] | undefined = undefined;
        // if (searchTermForApi) { // Only construct if there's a search term
        //     if (isGlobalSearchEnabled) {
        //         searchFieldsForBackend = globalSearchFieldList;
        //     } else {
        //         searchFieldsForBackend = [defaultSearchField];
        //     }
        // }
        // --- END NEW ---


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
        };

        // console.log("[useServerDataTable calling custom backend adapter] Payload:", payload);

        try {
            const response = await call(payload);
            if (response.message) {
                setData(response.message.data);
                setTotalCount(response.message.total_count);
            } else {
                console.warn('Custom API call successful but no message received.');
                setData([]); setTotalCount(0);
            }
        } catch (err: any) {
            console.error("Error fetching data via custom backend adapter:", err);
            const errorMessage = err.message || (err._server_messages ? JSON.parse(err._server_messages)[0].message : 'An unknown error occurred');
            setError(err instanceof Error ? err : new Error(errorMessage));
            setData([]); setTotalCount(0);
        }
    }, [
        call, doctype, JSON.stringify(fetchFields),
        pagination.pageIndex, pagination.pageSize, JSON.stringify(sorting),
        JSON.stringify(columnFilters), debouncedSearchTermForApi, 
        // isGlobalSearchEnabled,
        // defaultSearchField, 
        isItemSearchEnabled,
        JSON.stringify(globalSearchFieldList), defaultSort,
        JSON.stringify(additionalFilters), internalTrigger, // Added additionalFilters
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
        if (columnFilters.length > 0 || globalFilter || sorting.length > 0) {
            fetchData();
        } else if (!urlSyncKey){ // If no URL sync, fetch initially
           fetchData();
        }
        return;
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
        // getFilteredRowModel: getFilteredRowModel(), // Might not be strictly needed for server-side
        getFacetedRowModel: getFacetedRowModel(), // Useful for faceted filter UI options
        getFacetedUniqueValues: getFacetedUniqueValues(), // Useful for faceted filter UI options
        // Configuration
        enableRowSelection: enableRowSelection,
        // debugTable: process.env.NODE_ENV === 'development', // Enable debugging in dev
    });

     // --- Helper Functions ---
//      const toggleGlobalSearch = useCallback(() => {
//       setIsGlobalSearchEnabled(prev => {
//            const newState = !prev;
//            // Reset search term and page index when toggling global search type? Optional.
//            setGlobalFilter('');
//            setDebouncedSearchTermForApi('');
//            setPagination(p => ({ ...p, pageIndex: 0 }));
//            return newState;
//       });
//   }, []);

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

    const refetch = useCallback(() => {
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
        // isGlobalSearchEnabled,
        // toggleGlobalSearch,
        isItemSearchEnabled, 
        toggleItemSearch, // Add new item search state/toggle
        showItemSearchToggle: enableItemSearch, // Indicate if toggle should be shown
        refetch,
    };
}