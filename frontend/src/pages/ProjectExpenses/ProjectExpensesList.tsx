// src/pages/ProjectExpenses/ProjectExpensesList.tsx

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { ColumnDef, Row } from "@tanstack/react-table";
import { useFrappeDeleteDoc, useFrappeGetDocCount, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import {
  useServerDataTable,
  AggregationConfig,
  GroupByConfig,
  getUrlStringParam,
} from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { urlStateManager } from "@/utils/urlStateManager";
import memoize from "lodash/memoize";
import { cn } from "@/lib/utils";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

// Types
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// Config & Dialogs
import {
  DEFAULT_PE_FIELDS_TO_FETCH,
  PE_SEARCHABLE_FIELDS,
  PE_DATE_COLUMNS,
  DOCTYPE,
} from "./config/projectExpensesTable.config";
import { getProjectExpenseColumns } from "./config/projectExpensesColumns";
import { NewProjectExpenseDialog } from "./components/NewProjectExpenseDialog";
import { EditProjectExpenseDialog } from "./components/EditProjectExpenseDialog";
import { ProjectExpenseSummaryCard } from "./components/ProjectExpenseSummaryCard";

// UI Components
import { DataTable } from "@/components/data-table/new-data-table";
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

interface ProjectExpensesListProps {
  projectId?: string; // Optional: To filter by a specific project
}

// NEW: Configuration for the summary card aggregations
const PE_AGGREGATES_CONFIG: AggregationConfig[] = [
  { field: "amount", function: "sum" },
];

// NEW: Configuration for the "Top 5" group by request
const PE_GROUP_BY_CONFIG: GroupByConfig = {
  groupByField: "type",
  aggregateField: "amount",
  aggregateFunction: "sum",
  limit: 5,
};

// URL param key for the active status workflow tab. Namespaced ("pe_status") so
// it never collides with the project page's own ?tab=/?page= params when this
// list is embedded as a project tab.
const PE_STATUS_TAB_PARAM = "pe_status";

export const ProjectExpensesList: React.FC<ProjectExpensesListProps> = ({
  projectId,
}) => {
  // Standalone list (no projectId) grows to natural height for a single page
  // scroll; the embedded project tab (projectId set) keeps the fixed-height
  // internal table scroll.
  const autoHeight = !projectId;
  const { setEditProjectExpenseDialog } = useDialogStore();
  const { toast } = useToast();
  const { role } = useUserData();
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
  const { ceoHoldProjectIds } = useCEOHoldProjects();

  // CEO Hold row highlighting
  const getRowClassName = useCallback(
    (row: Row<ProjectExpenses>) => {
      const projId = row.original.projects;
      if (projId && ceoHoldProjectIds.has(projId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      return undefined;
    },
    [ceoHoldProjectIds]
  );

  const [expenseToEdit, setExpenseToEdit] = useState<ProjectExpenses | null>(
    null
  );
  const [expenseToDelete, setExpenseToDelete] =
    useState<ProjectExpenses | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  // Default tab is role-based: Accountant (and Lead) land on "Approved", everyone
  // else (Admin included) on "Requested". A URL param (deep link / reload) overrides it.
  const isAccountantUser =
    role === "Nirmaan Accountant Profile" ||
    role === "Nirmaan Accountant Lead Profile";
  const defaultStatusTab = isAccountantUser ? "Approved" : "Requested";
  const [statusTab, setStatusTab] = useState<string>(() =>
    getUrlStringParam(PE_STATUS_TAB_PARAM, defaultStatusTab)
  );
  const [statusAction, setStatusAction] = useState<{
    expense: ProjectExpenses;
    next: "Approved" | "Paid";
  } | null>(null);
  const [markPaidMode, setMarkPaidMode] = useState(false);

  // --- Keep the active status tab in sync with the URL (deep-link + back/forward) ---
  // Persist tab -> URL (replaceState, so it doesn't pollute browser history).
  useEffect(() => {
    if (urlStateManager.getParam(PE_STATUS_TAB_PARAM) !== statusTab) {
      urlStateManager.updateParam(PE_STATUS_TAB_PARAM, statusTab);
    }
  }, [statusTab]);
  // React to URL -> tab changes (back/forward navigation, external deep links).
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe(
      PE_STATUS_TAB_PARAM,
      (_, value) => {
        const next = value || defaultStatusTab;
        setStatusTab((prev) => (prev !== next ? next : prev));
      }
    );
    return unsubscribe;
  }, [defaultStatusTab]);

  // --- Supporting Data for Lookups ---
  const { data: projects, isLoading: projectsLoading } =
    useFrappeGetDocList<Projects>("Projects", {
      fields: ["name", "project_name"],
      orderBy: { field: "project_name", order: "asc" },
      limit: 0,
    });
  const { data: vendors, isLoading: vendorsLoading } =
    useFrappeGetDocList<Vendors>("Vendors", {
      fields: ["name", "vendor_name"],
      orderBy: { field: "vendor_name", order: "asc" },
      limit: 0,
    });
  const { data: users, isLoading: usersLoading } =
    useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
      fields: ["name", "full_name"],
      orderBy: { field: "full_name", order: "asc" },
      limit: 0,
    });
  const { data: expenseTypes, isLoading: expenseTypesLoading } =
    useFrappeGetDocList<ExpenseType>("Expense Type", {
      fields: ["name", "expense_name"],
      orderBy: { field: "expense_name", order: "asc" },
      filters: [["project", "=", "1"]],
      limit: 0,
    });

  const getProjectName = useCallback(
    memoize(
      (id?: string) =>
        projects?.find((p) => p.name === id)?.project_name || id || "--"
    ),
    [projects]
  );
  const getVendorName = useCallback(
    memoize(
      (id?: string) =>
        vendors?.find((v) => v.name === id)?.vendor_name || id || "Others"
    ),
    [vendors]
  );
  const getUserName = useCallback(
    memoize(
      (id?: string) =>
        users?.find((u) => u.name === id)?.full_name || id || "--"
    ),
    [users]
  );
  const getExpenseTypeName = useCallback(
    memoize(
      (id?: string) =>
        expenseTypes?.find((et) => et.name === id)?.expense_name || id || "--"
    ),
    [expenseTypes]
  );

  // --- (1) NEW: Prepare options for the faceted filters ---

  // --- Handlers for Actions ---
  const handleOpenEditDialog = useCallback(
    (expense: ProjectExpenses) => {
      setExpenseToEdit(expense);
      setMarkPaidMode(false);
      setEditProjectExpenseDialog(true);
    },
    [setEditProjectExpenseDialog]
  );
  const handleOpenDeleteDialog = useCallback((expense: ProjectExpenses) => {
    setExpenseToDelete(expense);
    setIsDeleteDialogOpen(true);
  }, []);
  const handleOpenStatusDialog = useCallback(
    (expense: ProjectExpenses, next: "Approved" | "Paid") => {
      setStatusAction({ expense, next });
    },
    []
  );
  const handleOpenMarkPaid = useCallback(
    (expense: ProjectExpenses) => {
      setExpenseToEdit(expense);
      setMarkPaidMode(true);
      setEditProjectExpenseDialog(true);
    },
    [setEditProjectExpenseDialog]
  );

  const confirmDelete = async () => {
    if (!expenseToDelete) return;
    try {
      await deleteDoc(DOCTYPE, expenseToDelete.name);
      toast({
        title: "Success",
        description: `Expense deleted successfully.`,
        variant: "success",
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete expense.",
        variant: "destructive",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setExpenseToDelete(null);
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

  const columns = useMemo<ColumnDef<ProjectExpenses>[]>(
    () =>
      getProjectExpenseColumns({
        statusTab,
        projectId,
        role,
        getProjectName,
        getVendorName,
        getUserName,
        onEdit: handleOpenEditDialog,
        onApprove: (expense) => handleOpenStatusDialog(expense, "Approved"),
        onMarkPaid: handleOpenMarkPaid,
        onDelete: handleOpenDeleteDialog,
      }),
    [
      statusTab,
      projectId,
      role,
      getProjectName,
      getVendorName,
      getUserName,
      handleOpenEditDialog,
      handleOpenStatusDialog,
      handleOpenMarkPaid,
      handleOpenDeleteDialog,
    ]
  );

  // --- Status workflow tab → base filters (project scope + active status tab) ---
  const baseFilters = useMemo(() => {
    const filters: any[] = [];
    if (projectId) filters.push(["projects", "=", projectId]);
    if (statusTab !== "All") filters.push(["status", "=", statusTab]);
    return filters;
  }, [projectId, statusTab]);

  // --- Per-status counts for the tab badges (project-scoped) ---
  const { data: requestedCount, mutate: mutateRequested } = useFrappeGetDocCount(
    DOCTYPE,
    projectId
      ? [["projects", "=", projectId], ["status", "=", "Requested"]]
      : [["status", "=", "Requested"]]
  );
  const { data: approvedCount, mutate: mutateApproved } = useFrappeGetDocCount(
    DOCTYPE,
    projectId
      ? [["projects", "=", projectId], ["status", "=", "Approved"]]
      : [["status", "=", "Approved"]]
  );
  const { data: paidCount, mutate: mutatePaid } = useFrappeGetDocCount(
    DOCTYPE,
    projectId
      ? [["projects", "=", projectId], ["status", "=", "Paid"]]
      : [["status", "=", "Paid"]]
  );
  const { data: allCount } = useFrappeGetDocCount(
    DOCTYPE,
    projectId ? [["projects", "=", projectId]] : undefined
  );

  const statusTabs = useMemo(
    () => [
      { label: "Requested", value: "Requested", count: requestedCount ?? 0 },
      { label: "Approved", value: "Approved", count: approvedCount ?? 0 },
      { label: "Paid", value: "Paid", count: paidCount ?? 0 },
      { label: "All", value: "All", count: allCount ?? 0 },
    ],
    [requestedCount, approvedCount, paidCount, allCount]
  );

  // --- Data Table Hook (MOVED UP) ---
  const {
    table,
    data,
    totalCount,
    isLoading,
    error,
    refetch,
    searchTerm, // <-- Destructure this
    setSearchTerm, // <-- Destructure this
    selectedSearchField, // <-- Destructure this
    setSelectedSearchField, // <-- Destructure this
    aggregates, // NEW
    isAggregatesLoading, // NEW
    columnFilters, // NEW
    groupByResult, // NEW
    exportAllRows,
    isExporting,
  } = useServerDataTable<ProjectExpenses>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: [
      ...DEFAULT_PE_FIELDS_TO_FETCH,
      "type.expense_name as expense_type_name",
    ], // Ensure display name is fetched
    searchableFields: PE_SEARCHABLE_FIELDS,
    urlSyncKey: `project_expenses_list_${projectId || "all"}_${statusTab.toLowerCase()}`,
    // Project scope + active status tab
    additionalFilters: baseFilters,
    aggregatesConfig: PE_AGGREGATES_CONFIG, // NEW: Pass the aggregation config
    groupByConfig: PE_GROUP_BY_CONFIG, // NEW: Pass the group by config
  });

  // --- Dynamic Facet Values (scoped to project + active status tab via baseFilters) ---

  const {
    facetOptions: projectFacetOptions,
    isLoading: isProjectFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "projects", // Confirm field name in Doctype is 'projects'? Based on accessorKey.
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: baseFilters,
    enabled: !projectId,
  });

  const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "vendor",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: baseFilters,
      enabled: true,
    });

  const { facetOptions: userFacetOptions, isLoading: isUserFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "payment_by",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: baseFilters,
      enabled: true,
    });

  const {
    facetOptions: expenseTypeFacetOptions,
    isLoading: isExpenseTypeFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "type",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: baseFilters,
    enabled: true,
  });

  const { facetOptions: statusFacetOptions, isLoading: isStatusFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "status",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: baseFilters,
      enabled: statusTab === "All",
    });

  const { facetOptions: ownerFacetOptions, isLoading: isOwnerFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "owner",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: baseFilters,
      enabled: statusTab !== "Paid",
    });

  // --- (2) NEW: Define the facet filter configurations ---
  const facetFilterOptions = useMemo(() => {
    const filters: any = {
      vendor: {
        title: "Vendor",
        options: vendorFacetOptions,
        isLoading: isVendorFacetLoading,
      },
      type: {
        title: "Expense Type",
        options: expenseTypeFacetOptions,
        isLoading: isExpenseTypeFacetLoading,
      },
    };

    // Payment By column (and filter) shows on the Paid and All tabs
    if (statusTab === "Paid" || statusTab === "All") {
      filters.payment_by = {
        title: "Payment By",
        options: userFacetOptions,
        isLoading: isUserFacetLoading,
      };
    }

    // Status filter only in the All tab (other tabs are already status-scoped)
    if (statusTab === "All") {
      filters.status = {
        title: "Status",
        options: statusFacetOptions,
        isLoading: isStatusFacetLoading,
      };
    }

    // Created By filter wherever the Created By column shows (non-Paid tabs)
    if (statusTab !== "Paid") {
      filters.owner = {
        title: "Created By",
        options: ownerFacetOptions,
        isLoading: isOwnerFacetLoading,
      };
    }

    // Conditionally add the project filter only if we are on the main list view
    if (!projectId) {
      filters.projects = {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      };
    }

    return filters;
  }, [
    userFacetOptions,
    isUserFacetLoading,
    vendorFacetOptions,
    isVendorFacetLoading,
    expenseTypeFacetOptions,
    isExpenseTypeFacetLoading,
    statusFacetOptions,
    isStatusFacetLoading,
    ownerFacetOptions,
    isOwnerFacetLoading,
    projectFacetOptions,
    isProjectFacetLoading,
    projectId,
    statusTab,
  ]);

  // --- (2) NEW: Define the facet filter configurations ---

  // --- Data Table Hook ---

  const isLoadingLookups =
    vendorsLoading ||
    usersLoading ||
    expenseTypesLoading ||
    (!projectId && projectsLoading);
  if (error) return <AlertDestructive error={error} />;

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
      <DataTable
        table={table}
        columns={columns}
        isLoading={isLoading || isLoadingLookups}
        error={error}
        totalCount={totalCount}
        searchFieldOptions={PE_SEARCHABLE_FIELDS}
        dateFilterColumns={PE_DATE_COLUMNS}
        facetFilterOptions={facetFilterOptions}
        showExportButton={true}
        onExport="default"
        onExportAll={exportAllRows}
        isExporting={isExporting}
        exportFileName={`Project_Expenses_${projectId ? getProjectName(projectId) : "All"}`}
        getRowClassName={getRowClassName}
        // --- (Indicator) FIX: Explicitly pass the required props with the correct names ---
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        summaryCard={
          <ProjectExpenseSummaryCard
            aggregates={aggregates}
            isAggregatesLoading={isAggregatesLoading}
            totalCount={totalCount}
            columnFilters={columnFilters}
            searchTerm={searchTerm}
            groupByResult={groupByResult}
            getExpenseTypeName={getExpenseTypeName}
            projectName={projectId ? getProjectName(projectId) : undefined}
          />
        }
      />
      <NewProjectExpenseDialog projectId={projectId} onSuccess={refetch} />
      {expenseToEdit && (
        <EditProjectExpenseDialog
          expenseToEdit={expenseToEdit}
          markAsPaid={markPaidMode}
          onSuccess={() => {
            refetch();
            mutateRequested();
            mutateApproved();
            mutatePaid();
            setEditProjectExpenseDialog(false);
          }}
        />
      )}
      {expenseToDelete && (
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the expense:{" "}
                <span className="font-semibold">
                  {expenseToDelete.description}
                </span>
                .
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setExpenseToDelete(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={deleteLoading}
                className="bg-destructive hover:bg-destructive/90"
              >
                {deleteLoading ? "Deleting..." : "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {statusAction && (
        <AlertDialog
          open={!!statusAction}
          onOpenChange={(open) => !open && setStatusAction(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {statusAction.next === "Approved"
                  ? "Approve this expense?"
                  : "Mark this expense as Paid?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {statusAction.next === "Approved"
                  ? "This moves the expense from Requested to Approved."
                  : "This moves the expense from Approved to Paid."}{" "}
                <span className="font-semibold">
                  {statusAction.expense.description}
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
