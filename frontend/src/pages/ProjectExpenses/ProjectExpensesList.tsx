// src/pages/ProjectExpenses/ProjectExpensesList.tsx

import React, { useMemo, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeDeleteDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import {
  useServerDataTable,
  AggregationConfig,
  GroupByConfig,
} from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import memoize from "lodash/memoize";
import { cn } from "@/lib/utils";

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
import { NewProjectExpenseDialog } from "./components/NewProjectExpenseDialog";
import { EditProjectExpenseDialog } from "./components/EditProjectExpenseDialog";
import { ProjectExpenseSummaryCard } from "./components/ProjectExpenseSummaryCard";

// UI Components
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Edit2, MoreHorizontal, PlusCircle, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TailSpin } from "react-loader-spinner";

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

// NEW: Helper component to display active filters in the summary card
const AppliedFiltersDisplay = ({ filters, search }) => {
  const hasFilters = filters.length > 0 || !!search;
  if (!hasFilters) {
    return (
      <p className="text-sm text-gray-500">Overview of all project expenses.</p>
    );
  }
  return (
    <div className="text-sm text-gray-500 flex flex-wrap gap-2 items-center mt-2">
      <span className="font-medium">Filtered by:</span>
      {search && (
        <span className="px-2 py-1 bg-gray-200 rounded-md text-xs">{`Search: "${search}"`}</span>
      )}
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs capitalize whitespace-nowrap"
        >
          {filter.id.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
};

export const ProjectExpensesList: React.FC<ProjectExpensesListProps> = ({
  projectId,
}) => {
  const { toggleNewProjectExpenseDialog, setEditProjectExpenseDialog } =
    useDialogStore();
  const { toast } = useToast();
  const { role } = useUserData();
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();

  const [expenseToEdit, setExpenseToEdit] = useState<ProjectExpenses | null>(
    null
  );
  const [expenseToDelete, setExpenseToDelete] =
    useState<ProjectExpenses | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

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
      setEditProjectExpenseDialog(true);
    },
    [setEditProjectExpenseDialog]
  );
  const handleOpenDeleteDialog = useCallback((expense: ProjectExpenses) => {
    setExpenseToDelete(expense);
    setIsDeleteDialogOpen(true);
  }, []);

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

  const columns = useMemo<ColumnDef<ProjectExpenses>[]>(
    () => [
      // --- (Indicator) MODIFIED: Project column is now conditional ---
      ...(!projectId
        ? [
          {
            accessorKey: "projects",
            header: ({ column }) => (
              <DataTableColumnHeader column={column} title="Project" />
            ),
            cell: ({ row }) => (
              <Link
                to={`/projects/${row.original.projects}`}
                className="text-blue-600 hover:underline"
              >
                {getProjectName(row.original.projects)}
              </Link>
            ),
            enableColumnFilter: true,
            meta: { exportValue: (row) => getProjectName(row.projects) },
          } as ColumnDef<ProjectExpenses>,
        ]
        : []),
      {
        accessorKey: "payment_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Payment Date" />
        ),
        cell: ({ row }) => (
          <div className="font-medium">
            {formatDate(row.original.payment_date)}
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: "Expense Type",
        cell: ({ row }) => (
          <div
            className="truncate"
            title={row.original.expense_type_name || row.original.type}
          >
            {row.original.expense_type_name || row.original.type}
          </div>
        ),
        meta: { exportValue: (row) => row.expense_type_name || row.type },
        enableColumnFilter: true,
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <div className="truncate max-w-xs" title={row.original.description}>
            {row.original.description}
          </div>
        ),
      },
      {
        accessorKey: "comment",
        header: "Comment",
        cell: ({ row }) => (
          <div className="truncate max-w-xs" title={row.original.comment}>
            {row.original.comment}
          </div>
        ),
      },
      {
        accessorKey: "vendor",
        header: "Vendor",
        cell: ({ row }) => (
          <div className="truncate" title={getVendorName(row.original.vendor)}>
            {getVendorName(row.original.vendor)}
          </div>
        ),
        meta: { exportValue: (row) => getVendorName(row.vendor) },
        enableColumnFilter: true,
      },
      {
        accessorKey: "amount",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Amount"
            className="justify-center"
          />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2">
            {formatToRoundedIndianRupee(row.original.amount)}
          </div>
        ),
        meta: { exportValue: (row) => formatForReport(row.amount) },
      },
      {
        accessorKey: "payment_by",
        header: "Payment By",
        cell: ({ row }) => (
          <div
            className="truncate"
            title={getUserName(row.original.payment_by)}
          >
            {getUserName(row.original.payment_by)}
          </div>
        ),
        meta: { exportValue: (row) => getUserName(row.payment_by) },
        enableColumnFilter: true,
      },

      {
        id: "actions",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Actions"
            className="text-center"
          />
        ),
        cell: ({ row }) => (
          <div className="">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handleOpenEditDialog(row.original)}
                >
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {(role === "Nirmaan Admin Profile" ||
                  role === "Nirmaan PMO Executive Profile") && (
                    <DropdownMenuItem
                      onClick={() => handleOpenDeleteDialog(row.original)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        meta: {
          excludeFromExport: true, // Exclude actions column from export
        },
      },
    ],
    [
      projectId,
      getProjectName,
      getVendorName,
      getUserName,
      getExpenseTypeName,
      handleOpenEditDialog,
      handleOpenDeleteDialog,
    ]
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
  } = useServerDataTable<ProjectExpenses>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: [
      ...DEFAULT_PE_FIELDS_TO_FETCH,
      "type.expense_name as expense_type_name",
    ], // Ensure display name is fetched
    searchableFields: PE_SEARCHABLE_FIELDS,
    urlSyncKey: `project_expenses_list_${projectId || "all"}`,
    // --- (Indicator) Static filter is now conditional ---
    additionalFilters: projectId ? [["projects", "=", projectId]] : [],
    aggregatesConfig: PE_AGGREGATES_CONFIG, // NEW: Pass the aggregation config
    groupByConfig: PE_GROUP_BY_CONFIG, // NEW: Pass the group by config
  });

  // --- Dynamic Facet Values ---
  const staticFilters = useMemo(
    () => (projectId ? [["projects", "=", projectId]] : []),
    [projectId]
  );

  const {
    facetOptions: projectFacetOptions,
    isLoading: isProjectFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "projects", // Confirm field name in Doctype is 'projects'? Based on accessorKey.
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: !projectId,
  });

  const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "vendor",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  const { facetOptions: userFacetOptions, isLoading: isUserFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "payment_by",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters,
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
    additionalFilters: staticFilters,
    enabled: true,
  });

  // --- (2) NEW: Define the facet filter configurations ---
  const facetFilterOptions = useMemo(() => {
    const filters: any = {
      payment_by: {
        title: "Requested By",
        options: userFacetOptions,
        isLoading: isUserFacetLoading,
      },
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
    projectFacetOptions,
    isProjectFacetLoading,
    projectId,
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
        totalCount > 10
          ? "h-[calc(100vh-80px)]"
          : totalCount > 0
            ? "h-auto"
            : ""
      )}
    >
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
        exportFileName={`Project_Expenses_${projectId || "All"}`}
        toolbarActions={
          (role === "Nirmaan Admin Profile" ||
            role === "Nirmaan PMO Executive Profile" ||
            role === "Nirmaan Accountant Profile") && (
            <Button onClick={toggleNewProjectExpenseDialog} size="sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Project Expense
            </Button>
          )
        }
        // --- (Indicator) FIX: Explicitly pass the required props with the correct names ---
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        // MODIFIED: Pass the enhanced summary card
        summaryCard={
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-lg">
                Misc. Project Expenses Summary
              </CardTitle>
              <CardDescription>
                <AppliedFiltersDisplay
                  filters={columnFilters}
                  search={searchTerm}
                />
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isAggregatesLoading ? (
                <div className="flex justify-center items-center h-24">
                  <TailSpin height={24} width={24} color="#4f46e5" />
                </div>
              ) : aggregates ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  {/* Section 1: Overall Totals */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-gray-700">
                      Overall Totals
                    </h4>
                    <dl className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <dt className="text-muted-foreground">
                          Total Expense Amount
                        </dt>
                        <dd className="font-medium text-blue-600">
                          {formatToRoundedIndianRupee(
                            aggregates.sum_of_amount || 0
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between text-sm">
                        <dt className="text-muted-foreground">Total Entries</dt>
                        <dd className="font-medium">{totalCount}</dd>
                      </div>
                    </dl>
                  </div>
                  {/* Section 2: Top Expense Types */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-gray-700">
                      Top Expense Types
                    </h4>
                    {groupByResult && groupByResult.length > 0 ? (
                      <ul className="space-y-1">
                        {groupByResult.map((item) => (
                          <li
                            key={item.group_key}
                            className="flex justify-between text-sm"
                          >
                            <span
                              className="text-muted-foreground truncate pr-2"
                              title={getExpenseTypeName(item.group_key)}
                            >
                              {getExpenseTypeName(item.group_key)}
                            </span>
                            <span className="font-medium whitespace-nowrap">
                              {formatToRoundedIndianRupee(item.aggregate_value)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center pt-4">
                        No expense type breakdown available.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
                  No summary data available.
                </p>
              )}
            </CardContent>
          </Card>
        }
      />
      <NewProjectExpenseDialog projectId={projectId} onSuccess={refetch} />
      {expenseToEdit && (
        <EditProjectExpenseDialog
          expenseToEdit={expenseToEdit}
          onSuccess={() => {
            refetch();
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
    </div>
  );
};
