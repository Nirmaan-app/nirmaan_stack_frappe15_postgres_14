// src/pages/non-project-expenses/NonProjectExpensesPage.tsx

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import memoize from "lodash/memoize";

import {
  useFrappeDeleteDoc,
  useFrappeUpdateDoc,
  useFrappeGetDocCount,
  useFrappeGetDocList,
} from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";

// --- UI Components ---
import { DataTable } from "@/components/data-table/new-data-table";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { useSharedReportDateRange } from "@/pages/reports/store/useReportDateStore";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// --- Hooks & Utils ---
import {
  useServerDataTable,
  AggregationConfig,
  GroupByConfig,
  getUrlStringParam,
} from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { useDialogStore } from "@/zustand/useDialogStore";
import { urlStateManager } from "@/utils/urlStateManager";
import { useUserData } from "@/hooks/useUserData";
import { parse, formatISO, startOfDay, endOfDay } from "date-fns";

// --- Types ---
import { NonProjectExpenses as NonProjectExpensesType } from "@/types/NirmaanStack/NonProjectExpenses";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
// --- Config ---
import {
  DEFAULT_NPE_FIELDS_TO_FETCH,
  NPE_SEARCHABLE_FIELDS,
  NPE_DATE_COLUMNS,
} from "./config/nonProjectExpensesTable.config";
import { getNonProjectExpenseColumns } from "./config/nonProjectExpensesColumns";

// --- Child Components ---
import { NewNonProjectExpense } from "./components/NewNonProjectExpense";
import { EditNonProjectExpense } from "./components/EditNonProjectExpense";
import { UpdatePaymentDetailsDialog } from "./components/UpdatePaymentDetailsDialog";
import { UpdateInvoiceDetailsDialog } from "./components/UpdateInvoiceDetailsDialog";
import { NonProjectExpenseSummaryCard } from "./components/NonProjectExpenseSummaryCard";

const DOCTYPE = "Non Project Expenses";

// URL param key for the active status workflow tab (namespaced to avoid collision
// with the page's own date-range params).
const NPE_STATUS_TAB_PARAM = "npe_status";

// NEW: Configuration for the summary card aggregations
const NPE_AGGREGATES_CONFIG: AggregationConfig[] = [
  { field: "amount", function: "sum" },
];

// Date range configuration - default to "ALL" (no date filtering)

// NEW: Configuration for the "Top 5" group by request
const NPE_GROUP_BY_CONFIG: GroupByConfig = {
  groupByField: "type",
  aggregateField: "amount",
  aggregateFunction: "sum",
  limit: 5,
};

interface NonProjectExpensesPageProps {
  urlContext?: string;
  DisableAction?: boolean;
}

export const NonProjectExpensesPage: React.FC<NonProjectExpensesPageProps> = ({
  urlContext = "npe_default",
  DisableAction = false,
}) => {
  // Standalone page grows to natural height for a single page scroll; the report
  // embed (DisableAction) keeps the fixed-height internal table scroll.
  const autoHeight = !DisableAction;
  const {
    setEditNonProjectExpenseDialog, // NEW
    deleteConfirmationDialog, // NEW
    setDeleteConfirmationDialog, // NEW
  } = useDialogStore();
  const { toast } = useToast();
  const { role } = useUserData();
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc(); // For delete operation
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  // --- Status workflow tab (URL-synced, role-based default) ---
  // Accountant lands on Approved (their action = Record Payment + Mark as Paid);
  // everyone else on Requested. A ?npe_status= param overrides it.
  const isAccountantUser =
    role === "Nirmaan Accountant Profile" ||
    role === "Nirmaan Accountant Lead Profile";
  const defaultStatusTab = isAccountantUser ? "Approved" : "Requested";
  const [statusTab, setStatusTab] = useState<string>(() =>
    getUrlStringParam(NPE_STATUS_TAB_PARAM, defaultStatusTab)
  );
  useEffect(() => {
    if (urlStateManager.getParam(NPE_STATUS_TAB_PARAM) !== statusTab) {
      urlStateManager.updateParam(NPE_STATUS_TAB_PARAM, statusTab);
    }
  }, [statusTab]);
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe(
      NPE_STATUS_TAB_PARAM,
      (_, value) => {
        const next = value || defaultStatusTab;
        setStatusTab((prev) => (prev !== next ? next : prev));
      }
    );
    return unsubscribe;
  }, [defaultStatusTab]);

  // --- Users lookup for the "Created By" column ---
  const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 0,
  });
  const getUserName = useCallback(
    memoize(
      (id?: string) =>
        users?.find((u) => u.name === id)?.full_name || id || "--"
    ),
    [users]
  );

  // --- Per-status counts for the tab badges (whole dataset, not date-scoped) ---
  const { data: requestedCount, mutate: mutateRequested } =
    useFrappeGetDocCount(DOCTYPE, [["status", "=", "Requested"]]);
  const { data: approvedCount, mutate: mutateApproved } =
    useFrappeGetDocCount(DOCTYPE, [["status", "=", "Approved"]]);
  const { data: paidCount, mutate: mutatePaid } =
    useFrappeGetDocCount(DOCTYPE, [["status", "=", "Paid"]]);
  const { data: allCount } = useFrappeGetDocCount(DOCTYPE, undefined);

  const statusTabs = useMemo(
    () => [
      { label: "Requested", value: "Requested", count: requestedCount ?? 0 },
      { label: "Approved", value: "Approved", count: approvedCount ?? 0 },
      { label: "Paid", value: "Paid", count: paidCount ?? 0 },
      { label: "All", value: "All", count: allCount ?? 0 },
    ],
    [requestedCount, approvedCount, paidCount, allCount]
  );

  const urlSyncKey = useMemo(() => `npe_${urlContext}`, [urlContext]);

  // 1. Date range.
  //    - As the "Outflow (Non-Project)" REPORT (DisableAction), use the SHARED
  //      report date store so it stays in sync with Cash Sheet / Inflow / Outflow
  //      and never freezes (relative presets recompute from today on every load).
  //    - As the standalone page, keep an independent local range (own URL key).
  const shared = useSharedReportDateRange();
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(() => {
    const fromParam = urlStateManager.getParam(`${urlSyncKey}_from`);
    const toParam = urlStateManager.getParam(`${urlSyncKey}_to`);
    if (fromParam && toParam) {
      try {
        return {
          from: startOfDay(parse(fromParam, "yyyy-MM-dd", new Date())),
          to: endOfDay(parse(toParam, "yyyy-MM-dd", new Date())),
        };
      } catch (e) {
        console.error("Error parsing date from URL:", e);
      }
    }
    return undefined; // Default to "ALL" (no date filtering)
  });

  const dateRange = DisableAction ? shared.dateRange : localDateRange;
  const onDateChange = DisableAction ? shared.onChange : (r?: DateRange) => setLocalDateRange(r);
  const onDateClear = DisableAction ? shared.onClear : () => setLocalDateRange(undefined);

  // 2. Standalone page persists its own range to the URL.
  //    (In report mode the shared store handles persistence.)
  useEffect(() => {
    if (DisableAction) return;
    const fromISO = localDateRange?.from
      ? formatISO(localDateRange.from, { representation: "date" })
      : null;
    const toISO = localDateRange?.to
      ? formatISO(localDateRange.to, { representation: "date" })
      : null;

    urlStateManager.updateParam(`${urlSyncKey}_from`, fromISO);
    urlStateManager.updateParam(`${urlSyncKey}_to`, toISO);
  }, [localDateRange, urlSyncKey, DisableAction]);

  // 3. Build additional filters based on date range
  const dateFilters = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];
    const fromISO = formatISO(dateRange.from, { representation: "date" });
    const toISO = formatISO(dateRange.to, { representation: "date" });
    return [
      ["payment_date", ">=", fromISO],
      ["payment_date", "<=", toISO],
    ];
  }, [dateRange]);

  // State for update dialogs (define these first as handlers depend on them)
  const [isPaymentUpdateDialogOpen, setIsPaymentUpdateDialogOpen] =
    useState(false);
  const [isInvoiceUpdateDialogOpen, setIsInvoiceUpdateDialogOpen] =
    useState(false);
  const [selectedExpenseForUpdate, setSelectedExpenseForUpdate] =
    useState<NonProjectExpensesType | null>(null);
  const [selectedExpenseForEdit, setSelectedExpenseForEdit] =
    useState<NonProjectExpensesType | null>(null); // NEW
  const [expenseToDelete, setExpenseToDelete] =
    useState<NonProjectExpensesType | null>(null); // NEW for delete context
  const [markPaidMode, setMarkPaidMode] = useState(false);
  const [statusAction, setStatusAction] = useState<{
    expense: NonProjectExpensesType;
    next: "Approved" | "Paid";
  } | null>(null);

  // Define handlers (these are dependencies for `columnsDefinition`)
  // Accountant "Mark as Paid" -> opens the payment dialog in mark-paid mode, which
  // records the payment details AND sets status = "Paid" on submit.
  const handleOpenMarkPaid = useCallback(
    (expense: NonProjectExpensesType) => {
      setSelectedExpenseForUpdate(expense);
      setMarkPaidMode(true);
      setIsPaymentUpdateDialogOpen(true);
    },
    []
  );

  // Creator "Record Invoice" -> opens the invoice-details dialog.
  const handleOpenInvoiceUpdateDialog = useCallback(
    (expense: NonProjectExpensesType) => {
      setSelectedExpenseForUpdate(expense);
      setIsInvoiceUpdateDialogOpen(true);
    },
    []
  );

  // Admin "Approve" -> confirm dialog that moves Requested -> Approved.
  const handleOpenApprove = useCallback((expense: NonProjectExpensesType) => {
    setStatusAction({ expense, next: "Approved" });
  }, []);

  const handleOpenEditDialog = useCallback(
    (expense: NonProjectExpensesType) => {
      // NEW
      setSelectedExpenseForEdit(expense);
      setEditNonProjectExpenseDialog(true);
    },
    [setEditNonProjectExpenseDialog]
  );

  const handleOpenDeleteConfirmation = useCallback(
    (expense: NonProjectExpensesType) => {
      // NEW
      setExpenseToDelete(expense);
      setDeleteConfirmationDialog(true);
    },
    [setDeleteConfirmationDialog]
  );

  const confirmDeleteExpense = async () => {
    // NEW
    if (!expenseToDelete) return;
    try {
      await deleteDoc(DOCTYPE, expenseToDelete.name);
      toast({
        title: "Success",
        description: `Expense "${expenseToDelete.name}" deleted successfully.`,
        variant: "success",
      });
      refetch(); // Refetch table data
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete expense.",
        variant: "destructive",
      });
    } finally {
      setExpenseToDelete(null);
      setDeleteConfirmationDialog(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusAction) return;
    try {
      await updateDoc(DOCTYPE, statusAction.expense.name, {
        status: statusAction.next,
      });
      toast({
        title: "Success",
        description: `Expense marked ${statusAction.next}.`,
        variant: "success",
      });
      refetch();
      mutateRequested();
      mutateApproved();
      mutatePaid();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status.",
        variant: "destructive",
      });
    } finally {
      setStatusAction(null);
    }
  };

  // Status workflow tab -> base filter (combined with the date-range filter).
  // Report mode (DisableAction) = the Outflow (Non-Project) report -> settled
  // cash-out only, so force status = Paid. The standalone page uses the active
  // status tab instead (All tab = no status filter).
  const additionalFilters = useMemo(() => {
    const filters: any[] = [...dateFilters];
    if (DisableAction) {
      filters.push(["status", "=", "Paid"]);
    } else if (statusTab !== "All") {
      filters.push(["status", "=", statusTab]);
    }
    return filters;
  }, [dateFilters, statusTab, DisableAction]);

  // Columns live in ./config/nonProjectExpensesColumns (tab-aware + role-gated).
  // In report mode (DisableAction) show the full "All" column set with no actions.
  const columnsDefinition = useMemo(
    () =>
      getNonProjectExpenseColumns({
        statusTab: DisableAction ? "All" : statusTab,
        role,
        getUserName,
        disableActions: DisableAction,
        onEdit: handleOpenEditDialog,
        onApprove: handleOpenApprove,
        onRecordInvoice: handleOpenInvoiceUpdateDialog,
        onMarkPaid: handleOpenMarkPaid,
        onDelete: handleOpenDeleteConfirmation,
      }),
    [
      statusTab,
      DisableAction,
      role,
      getUserName,
      handleOpenEditDialog,
      handleOpenApprove,
      handleOpenInvoiceUpdateDialog,
      handleOpenMarkPaid,
      handleOpenDeleteConfirmation,
    ]
  );

  // --- Use the Server Data Table Hook ---
  const {
    table,
    data,
    totalCount,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    refetch,
    aggregates, // NEW
    isAggregatesLoading, // NEW
    columnFilters, // NEW: To display applied filters
    groupByResult, // NEW
    exportAllRows,
    isExporting,
  } = useServerDataTable<NonProjectExpensesType>({
    doctype: DOCTYPE,
    columns: columnsDefinition, // *** PASS THE DEFINED COLUMNS HERE ***
    fetchFields: DEFAULT_NPE_FIELDS_TO_FETCH,
    searchableFields: NPE_SEARCHABLE_FIELDS,
    urlSyncKey: urlSyncKey,
    defaultSort: "payment_date desc",
    enableRowSelection: false, // Or true if actions on rows are needed
    aggregatesConfig: NPE_AGGREGATES_CONFIG, // NEW: Pass the config
    groupByConfig: NPE_GROUP_BY_CONFIG, // NEW: Pass the group by config
    additionalFilters: additionalFilters, // date range + active status tab
  });

  // --- Dynamic Facet Values ---
  const {
    facetOptions: expenseTypeFacetOptions,
    isLoading: isExpenseTypeFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "type",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters,
    enabled: true,
  });

  const { facetOptions: ownerFacetOptions, isLoading: isOwnerFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "owner",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters,
      enabled: !DisableAction,
    });

  const { facetOptions: statusFacetOptions, isLoading: isStatusFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "status",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters,
      enabled: !DisableAction && statusTab === "All",
    });

  // --- (4) NEW: Define the facet filter configuration object ---
  const facetFilterOptions = useMemo(() => {
    const filters: any = {
      type: {
        // This key 'type' MUST match the column's accessorKey
        title: "Expense Type",
        options: expenseTypeFacetOptions,
        isLoading: isExpenseTypeFacetLoading,
      },
    };
    if (!DisableAction) {
      filters.owner = {
        title: "Created By",
        options: ownerFacetOptions,
        isLoading: isOwnerFacetLoading,
      };
    }
    if (!DisableAction && statusTab === "All") {
      filters.status = {
        title: "Status",
        options: statusFacetOptions,
        isLoading: isStatusFacetLoading,
      };
    }
    return filters;
  }, [
    expenseTypeFacetOptions,
    isExpenseTypeFacetLoading,
    ownerFacetOptions,
    isOwnerFacetLoading,
    statusFacetOptions,
    isStatusFacetLoading,
    DisableAction,
    statusTab,
  ]);

  const handleClearDateFilter = useCallback(() => {
    onDateClear(); // Reset to "ALL" (no date filtering)
  }, [onDateClear]);

  if (error && !data?.length) {
    return <AlertDestructive error={error} className="m-4" />;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        autoHeight
          ? "h-auto"
          : totalCount > 10
            ? "h-[calc(100vh-80px)]"
            : totalCount > 0
              ? "h-auto"
              : ""
      )}
    >
      <StandaloneDateFilter
        value={dateRange}
        onChange={onDateChange}
        onClear={handleClearDateFilter}
      />
      {!DisableAction && (
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
          <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
            {statusTabs.map((sTab) => {
              const isActive = statusTab === sTab.value;
              return (
                <button
                  key={sTab.value}
                  type="button"
                  onClick={() => setStatusTab(sTab.value)}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    isActive
                      ? "bg-sky-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {sTab.label}
                  <span
                    className={`text-xs font-bold ${
                      isActive ? "opacity-90" : "opacity-70"
                    }`}
                  >
                    {sTab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <DataTable<NonProjectExpensesType>
        table={table} // This table instance is now created with columns
        columns={columnsDefinition} // Pass the same columns definition for export/etc.
        isLoading={isLoading || isExpenseTypeFacetLoading}
        error={error}
        totalCount={totalCount}
        searchFieldOptions={NPE_SEARCHABLE_FIELDS} // Make sure this is an array of SearchFieldOption
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        // facetFilterOptions={facetFilterOptions} // Define if needed
        facetFilterOptions={facetFilterOptions}
        dateFilterColumns={NPE_DATE_COLUMNS}
        showExportButton={true}
        onExport={"default"}
        onExportAll={exportAllRows}
        isExporting={isExporting}
        exportFileName={`Non_Project_Expenses_${urlContext}`}
        summaryCard={
          <NonProjectExpenseSummaryCard
            aggregates={aggregates}
            isAggregatesLoading={isAggregatesLoading}
            totalCount={totalCount}
            columnFilters={columnFilters}
            searchTerm={searchTerm}
            groupByResult={groupByResult}
          />
        }
      // errorMessage="Could not load expenses. Please try again." // Already handled by main error display
      />
      <NewNonProjectExpense
        refetchList={() => {
          refetch();
          mutateRequested();
          mutateApproved();
          mutatePaid();
        }}
      />

      {selectedExpenseForEdit && ( // NEW: Render Edit Dialog
        <EditNonProjectExpense
          expenseToEdit={selectedExpenseForEdit}
          onSuccess={() => {
            refetch();
            mutateRequested();
            mutateApproved();
            mutatePaid();
            setEditNonProjectExpenseDialog(false); // Close dialog on success
          }}
        />
      )}

      {selectedExpenseForUpdate && (
        <>
          <UpdatePaymentDetailsDialog
            isOpen={isPaymentUpdateDialogOpen}
            setIsOpen={setIsPaymentUpdateDialogOpen}
            expense={selectedExpenseForUpdate}
            markAsPaid={markPaidMode}
            onSuccess={() => {
              refetch();
              mutateRequested();
              mutateApproved();
              mutatePaid();
            }}
          />
          <UpdateInvoiceDetailsDialog
            isOpen={isInvoiceUpdateDialogOpen}
            setIsOpen={setIsInvoiceUpdateDialogOpen}
            expense={selectedExpenseForUpdate}
            onSuccess={() => {
              refetch();
              mutateRequested();
              mutateApproved();
              mutatePaid();
            }}
          />
        </>
      )}
      {/* NEW: Delete Confirmation Dialog */}
      {expenseToDelete && (
        <AlertDialog
          open={deleteConfirmationDialog}
          onOpenChange={setDeleteConfirmationDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the
                expense
                <span className="font-semibold mx-1">
                  {expenseToDelete.description || expenseToDelete.name}
                </span>
                .
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setExpenseToDelete(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteExpense}
                disabled={deleteLoading}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {deleteLoading ? "Deleting..." : "Yes, delete expense"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {/* Approve confirmation (Requested -> Approved) */}
      {statusAction && (
        <AlertDialog
          open={!!statusAction}
          onOpenChange={(open) => !open && setStatusAction(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve this expense?</AlertDialogTitle>
              <AlertDialogDescription>
                This moves the expense from Requested to Approved.
                <span className="font-semibold mx-1">
                  {statusAction.expense.description || statusAction.expense.name}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setStatusAction(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmStatusChange}
                disabled={updateLoading}
              >
                {updateLoading ? "Updating..." : "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

export default NonProjectExpensesPage;
