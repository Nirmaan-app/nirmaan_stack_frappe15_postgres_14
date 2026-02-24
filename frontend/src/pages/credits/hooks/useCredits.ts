/**
 * useCredits - Custom hook for Credits (PO Payment Terms) table
 *
 * This hook uses a dedicated backend API (get_credits_list) that filters
 * at the CHILD ROW level instead of the parent level. This ensures:
 * - "Due" tab only shows payment terms that individually meet the criteria
 *   (term_status='Created' AND due_date <= today)
 * - Not all sibling rows from a parent PO that has ANY matching child
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  PaginationState,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
} from "@tanstack/react-table";
import { useFrappePostCall } from "frappe-react-sdk";
import { debounce } from "lodash";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useNavigate } from "react-router-dom";
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms";
import { getCreditsColumns } from "../components/CreditsTableColumns";
import { toast } from "@/components/ui/use-toast";
import { ApiResponse } from "@/types/NirmaanStack/ApiResponse";
import {
  TERM_SEARCHABLE_FIELDS,
  TERM_DATE_COLUMNS,
  PAYMENT_TERM_STATUS_OPTIONS,
  CREDIT_FACET_FILTER_OPTIONS,
} from "../credits.constant";
import { useFacetValues } from "@/hooks/useFacetValues";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";

// --- Constants ---
const DEBOUNCE_DELAY = 500;
const API_ENDPOINT = "nirmaan_stack.api.credits.get_credits_list.get_credits_list";

// --- URL State Helpers ---
const getUrlIntParam = (key: string, defaultValue: number): number => {
  const val = urlStateManager.getParam(key);
  const num = parseInt(val || "", 10);
  return isNaN(num) || num < 0 ? defaultValue : num;
};

const getUrlStringParam = (key: string, defaultValue: string): string => {
  return urlStateManager.getParam(key) ?? defaultValue;
};

// Base64 encode/decode for filter URL persistence
const encodeFiltersForUrl = (filters: ColumnFiltersState): string | null => {
  if (!filters || filters.length === 0) return null;
  try {
    return btoa(JSON.stringify(filters));
  } catch (e) {
    console.error("Failed to encode filters:", e);
    return null;
  }
};

const decodeFiltersFromUrl = (encodedString: string | null): ColumnFiltersState => {
  if (!encodedString) return [];
  try {
    const parsed = JSON.parse(atob(encodedString));
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "object" && "id" in item && "value" in item)) {
      return parsed as ColumnFiltersState;
    }
    return [];
  } catch (e) {
    return [];
  }
};

// --- Types ---
interface CreditsApiResponse {
  message: {
    data: PoPaymentTermRow[];
    total_count: number;
    aggregates?: {
      total_credit_amount: number;
      total_due_amount: number;
      total_paid_amount: number;
    };
  };
}

export const useCredits = () => {
  const creditsCounts = useDocCountStore((state) => state.counts.credits);
  const navigate = useNavigate();
  const urlSyncKey = "credits_terms_list";

  // --- Status Tab State ---
  const [currentStatus, setCurrentStatus] = useState<string>(
    () => urlStateManager.getParam("status") || "All"
  );

  // --- Payment Request Dialog State ---
  const [termToRequest, setTermToRequest] = useState<PoPaymentTermRow | null>(null);

  // --- CEO Hold Guard ---
  const { isCEOHold, showBlockedToast } = useCEOHoldGuard(termToRequest?.project);

  // --- API Calls ---
  const {
    call: fetchCredits,
    loading: isFetching,
    error: fetchError,
    reset: resetFetchState,
  } = useFrappePostCall<CreditsApiResponse>(API_ENDPOINT);

  const {
    call: requestPaymentApi,
    loading: isRequestingPayment,
  } = useFrappePostCall<ApiResponse>(
    "nirmaan_stack.api.payments.project_payments.create_project_payment"
  );

  // --- Pagination State ---
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: getUrlIntParam(`${urlSyncKey}_pageIdx`, 0),
    pageSize: getUrlIntParam(`${urlSyncKey}_pageSize`, 50),
  }));

  // --- Sorting State ---
  // Default to descending due_date (most urgent/overdue items first)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'due_date', desc: true }]);

  // --- Search State ---
  const [searchTerm, setSearchTerm] = useState<string>(
    () => getUrlStringParam(`${urlSyncKey}_q`, "")
  );
  const [selectedSearchField, setSelectedSearchField] = useState<string>(
    () => getUrlStringParam(`${urlSyncKey}_searchBy`, "name")
  );
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>(searchTerm);

  // --- Column Filters State ---
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const encoded = urlStateManager.getParam(`${urlSyncKey}_filters`);
    return decodeFiltersFromUrl(encoded);
  });

  // --- Column Visibility ---
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // --- Data State ---
  const [data, setData] = useState<PoPaymentTermRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [aggregates, setAggregates] = useState<{
    total_credit_amount: number;
    total_due_amount: number;
    total_paid_amount: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // --- Debounce Search ---
  const debouncedSetSearchTerm = useMemo(
    () =>
      debounce((value: string) => {
        setDebouncedSearchTerm(value);
        setPagination((p) => ({ ...p, pageIndex: 0 }));
      }, DEBOUNCE_DELAY),
    []
  );

  useEffect(() => {
    debouncedSetSearchTerm(searchTerm);
    return () => debouncedSetSearchTerm.cancel();
  }, [searchTerm, debouncedSetSearchTerm]);

  // --- URL State Sync (Subscribe) ---
  useEffect(() => {
    const handleStatusChange = (_key: string, value: string | null) =>
      setCurrentStatus(value || "All");
    urlStateManager.subscribe("status", handleStatusChange);
    return () => urlStateManager.unsubscribe("status", handleStatusChange);
  }, []);

  // --- URL State Sync (Update) ---
  const updateUrlParam = useCallback(
    (key: string, value: string | null) => {
      const fullKey = `${urlSyncKey}_${key}`;
      if (urlStateManager.getParam(fullKey) !== value) {
        urlStateManager.updateParam(fullKey, value);
      }
    },
    [urlSyncKey]
  );

  useEffect(() => updateUrlParam("pageIdx", pagination.pageIndex.toString()), [pagination.pageIndex, updateUrlParam]);
  useEffect(() => updateUrlParam("pageSize", pagination.pageSize.toString()), [pagination.pageSize, updateUrlParam]);
  useEffect(() => updateUrlParam("q", searchTerm || null), [searchTerm, updateUrlParam]);
  useEffect(() => updateUrlParam("searchBy", selectedSearchField), [selectedSearchField, updateUrlParam]);
  useEffect(() => {
    const encoded = encodeFiltersForUrl(columnFilters);
    updateUrlParam("filters", encoded);
  }, [columnFilters, updateUrlParam]);

  // --- Status Change Handler ---
  const handleStatusChange = useCallback((newStatus: string) => {
    urlStateManager.updateParam("status", newStatus === "All" ? null : newStatus);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, []);

  // --- Request Payment Dialog Handlers ---
  const handleOpenRequestDialog = useCallback((term: PoPaymentTermRow) => {
    setTermToRequest(term);
  }, []);

  const handleConfirmRequestPayment = useCallback(async () => {
    if (!termToRequest) return;

    if (isCEOHold) {
      showBlockedToast();
      return;
    }

    try {
      const result = await requestPaymentApi({
        doctype: "Procurement Orders",
        docname: termToRequest.name,
        project: termToRequest.project,
        vendor: termToRequest.vendor,  // Use vendor ID, not vendor_name
        amount: termToRequest.amount,
        ptname: termToRequest.ptname,
      });

      if (result && result.message && result.message.status === 200) {
        toast({
          title: "Success!",
          description: result.message.message,
          variant: "success",
        });
        invalidateSidebarCounts();
        fetchData(); // Refetch data
      } else {
        throw new Error(result?.message?.message || "An unknown error occurred.");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Could not request payment: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setTermToRequest(null);
    }
  }, [termToRequest, requestPaymentApi, isCEOHold, showBlockedToast]);

  // --- Columns Definition ---
  const columns = useMemo(
    () => getCreditsColumns(navigate, handleOpenRequestDialog, currentStatus),
    [navigate, handleOpenRequestDialog, currentStatus]
  );

  // --- Data Fetching ---
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    resetFetchState();

    // Build order_by from sorting state
    const orderBy = sorting.length > 0
      ? `${sorting[0].id} ${sorting[0].desc ? "desc" : "asc"}`
      : "due_date desc";

    const payload = {
      status_filter: currentStatus,
      filters: columnFilters.length > 0 ? JSON.stringify(columnFilters) : null,
      search_term: debouncedSearchTerm || null,
      search_field: selectedSearchField,
      order_by: orderBy,
      limit_start: pagination.pageIndex * pagination.pageSize,
      limit_page_length: pagination.pageSize,
      with_aggregates: true,
    };

    try {
      const response = await fetchCredits(payload);
      if (response.message) {
        setData(response.message.data || []);
        setTotalCount(response.message.total_count || 0);
        setAggregates(response.message.aggregates || null);
      } else {
        setData([]);
        setTotalCount(0);
        setAggregates(null);
      }
    } catch (err: any) {
      console.error("Error fetching credits data:", err);
      setError(err instanceof Error ? err : new Error(err.message || "Unknown error"));
      setData([]);
      setTotalCount(0);
      setAggregates(null);
    } finally {
      setIsLoading(false);
    }
  }, [
    currentStatus,
    columnFilters,
    debouncedSearchTerm,
    selectedSearchField,
    sorting,
    pagination.pageIndex,
    pagination.pageSize,
    fetchCredits,
    resetFetchState,
  ]);

  // --- Trigger Fetch on Dependencies Change ---
  useEffect(() => {
    invalidateSidebarCounts();
    fetchData();
  }, [fetchData]);

  // --- Refetch Function ---
  const refetch = useCallback(() => {
    invalidateSidebarCounts();
    fetchData();
  }, [fetchData]);

  // --- TanStack Table Instance ---
  const table = useReactTable<PoPaymentTermRow>({
    data,
    columns,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalCount > 0 ? Math.ceil(totalCount / pagination.pageSize) : -1,
    state: {
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  // --- Dynamic Facet Values ---
  // Note: For the custom API, we compute "additionalFilters" matching the old pattern
  // but this is only used for the facet value API calls (separate endpoint)
  const additionalFiltersForFacets = useMemo(() => {
    const filters: any[] = [
      ["status", "not in", ["Merged", "Inactive", "PO Amendment"]],
      ["PO Payment Terms", "payment_type", "=", "Credit"],
    ];
    if (currentStatus === "Due") {
      const today = new Date().toISOString().split("T")[0];
      filters.push(["PO Payment Terms", "term_status", "=", "Created"]);
      filters.push(["PO Payment Terms", "due_date", "<=", today]);
    } else if (currentStatus !== "All") {
      filters.push(["PO Payment Terms", "term_status", "=", currentStatus]);
    }
    return filters;
  }, [currentStatus]);

  const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
    doctype: "Procurement Orders",
    field: "project_name",
    currentFilters: columnFilters,
    searchTerm: debouncedSearchTerm,
    selectedSearchField: selectedSearchField,
    additionalFilters: additionalFiltersForFacets,
    enabled: true,
  });

  const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } = useFacetValues({
    doctype: "Procurement Orders",
    field: "vendor_name",
    currentFilters: columnFilters,
    searchTerm: debouncedSearchTerm,
    selectedSearchField: selectedSearchField,
    additionalFilters: additionalFiltersForFacets,
    enabled: true,
  });

  // Note: Status facet (display_status) uses static options from CREDIT_FACET_FILTER_OPTIONS
  // because "Due" is a computed status, not stored in the database

  // --- Payment Term Status Options with Counts ---
  const paymentTermStatusOptionsWithCounts = useMemo(() => {
    return PAYMENT_TERM_STATUS_OPTIONS.map((option) => {
      const count =
        creditsCounts?.[option.value.toLowerCase() as keyof typeof creditsCounts] || 0;
      return {
        ...option,
        label: `${option.label} (${count})`,
      };
    });
  }, [creditsCounts]);

  // --- Facet Filter Options ---
  // Status facet uses static options since display_status is computed and includes "Due"
  const facetFilterOptions = useMemo(() => {
    const dynamicOptions = { ...CREDIT_FACET_FILTER_OPTIONS };

    if (dynamicOptions.project_name) {
      dynamicOptions.project_name.options = projectFacetOptions;
      dynamicOptions.project_name.isLoading = isProjectFacetLoading;
    }

    if (dynamicOptions.vendor_name) {
      dynamicOptions.vendor_name.options = vendorFacetOptions;
      dynamicOptions.vendor_name.isLoading = isVendorFacetLoading;
    }

    // display_status uses static options defined in CREDIT_FACET_FILTER_OPTIONS
    // as it's a computed field (Due, Requested, Approved, Paid)

    return dynamicOptions;
  }, [
    projectFacetOptions,
    isProjectFacetLoading,
    vendorFacetOptions,
    isVendorFacetLoading,
  ]);

  return {
    table,
    data,
    totalCount,
    currentStatus,
    handleStatusChange,
    TERM_SEARCHABLE_FIELDS,
    TERM_DATE_COLUMNS,
    PAYMENT_TERM_STATUS_OPTIONS: paymentTermStatusOptionsWithCounts,
    facetFilterOptions,
    termToRequest,
    setTermToRequest,
    handleConfirmRequestPayment,
    isRequestingPayment,
    // State for DataTable component
    isLoading: isLoading || isFetching,
    error: error || (fetchError as Error | null),
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    columnFilters,
    refetch,
    // Aggregates for summary cards (if needed later)
    aggregates,
  };
};
