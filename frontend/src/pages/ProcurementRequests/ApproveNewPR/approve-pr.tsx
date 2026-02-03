import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef, Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import {
  useFrappeGetDocList,
  FrappeContext,
  FrappeConfig,
  useFrappeDocTypeEventListener,
  FrappeDoc,
  GetDocListArgs,
} from "frappe-react-sdk";

// --- UI Components ---
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { formatDate } from "@/utils/FormatDate";
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
import {
  NotificationType,
  useNotificationStore,
} from "@/zustand/useNotificationStore";

// --- Types ---
import {
  ProcurementRequest,
  ProcurementItem,
  Category,
} from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "./hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import {
  DEFAULT_PR_FIELDS_TO_FETCH,
  PR_DATE_COLUMNS,
  PR_SEARCHABLE_FIELDS,
} from "../config/prTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

// --- Constants ---
const DOCTYPE = "Procurement Requests";
const URL_SYNC_KEY = "pr_new_approve"; // Unique key for this specific table instance/view

// --- Component ---
export const ApprovePR: React.FC = () => {
  const { db } = useContext(FrappeContext) as FrappeConfig;

  // --- CEO Hold Row Highlighting ---
  const { ceoHoldProjectIds } = useCEOHoldProjects();

  const getRowClassName = useCallback(
    (row: Row<ProcurementRequest>) => {
      const projectId = row.original.project;
      if (projectId && ceoHoldProjectIds.has(projectId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      return undefined;
    },
    [ceoHoldProjectIds]
  );

  const projectsFetchOptions = getProjectListOptions();

  // --- Generate Query Keys ---
  const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

  // --- Supporting Data & Hooks ---
  const {
    data: projects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useFrappeGetDocList<Projects>(
    "Projects",
    projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
    projectQueryKey
  );
  const {
    data: userList,
    isLoading: userListLoading,
    error: userError,
  } = useUsersList(); // For owner display
  const { notifications, mark_seen_notification } = useNotificationStore();

  // --- (2) NEW: Fetch Work Packages for the filter dropdown ---
  const {
    data: wp_list,
    isLoading: wpLoading,
    error: wpError,
  } = useFrappeGetDocList<ProcurementPackages>(
    "Procurement Packages",
    {
      fields: ["work_package_name"],
      orderBy: { field: "work_package_name", order: "asc" },
      limit: 0,
    },
    "All_Work_Packages_For_PR_Filter"
  );

  // --- Memoized Options ---
  const projectOptions = useMemo(
    () =>
      projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
      })) || [],
    [projects]
  );

  const userOptions = useMemo(
    () =>
      userList?.map((u) => ({
        label: u.full_name,
        value: u.full_name === "Administrator" ? "Administrator" : u.name,
      })) || [],
    [userList]
  );

  const workPackageOptions = useMemo(() => {
    const packages =
      wp_list?.map((wp) => ({
        label: wp.work_package_name!,
        value: wp.work_package_name!,
      })) || [];
    // Add a "Custom" option for PRs without a linked package
    packages.unshift({ label: "Custom", value: "" });
    return packages;
  }, [wp_list]);

  // --- Notification Handling ---
  const handleNewPRSeen = useCallback(
    (notification: NotificationType | undefined) => {
      if (notification && notification.seen === "false") {
        mark_seen_notification(db, notification);
      }
    },
    [db, mark_seen_notification]
  );

  // --- Static Filters for this View ---
  const staticFilters = useMemo(
    () => [
      ["workflow_state", "=", "Pending"], // Filter specifically for "Pending" state PRs
    ],
    []
  );

  // --- Fields to Fetch ---

  const fieldsToFetch = useMemo(
    () =>
      DEFAULT_PR_FIELDS_TO_FETCH.concat([
        "creation",
        "modified",
        "category_list",
        "target_value",
      ]),
    []
  );

  const prSearchableFields = useMemo(
    () =>
      PR_SEARCHABLE_FIELDS.concat([
        {
          value: "work_package",
          label: "Work Package",
          placeholder: "Search by Work Package...",
        },
        {
          value: "owner",
          label: "Created By",
          placeholder: "Search by Created By...",
        },
      ]),
    []
  );

  // --- Date Filter Columns ---
  const dateColumns = useMemo(() => PR_DATE_COLUMNS, []);

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ProcurementRequest>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#PR" />
        ),
        cell: ({ row }) => {
          const data = row.original;
          const prId = data.name;
          const isNew = notifications.find(
            (item) =>
              item.docname === prId &&
              item.seen === "false" &&
              item.event_id === "pr:new" // Assuming this event ID for new PRs
          );
          return (
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleNewPRSeen(isNew)}
              className="font-medium flex items-center gap-2 relative group"
            >
              {isNew && (
                <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />
              )}
              <Link
                className="underline hover:underline-offset-2 whitespace-nowrap"
                to={`/procurement-requests/${prId}?tab=Approve PR`}
              >
                {prId?.slice(-4)}
              </Link>
              {!data.work_package && <Badge className="text-xs">Custom</Badge>}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDoc={data}
                  parentDoctype={DOCTYPE} // 'Procurement Requests'
                  childTableName={"order_list"} // Or "procurement_list" - check your DocType
                  isPR={true} // Pass relevant flags
                />
              </div>
            </div>
          );
        },
        size: 150,
        meta: {
          exportHeaderName: "PR ID",
          exportValue: (row: ProcurementRequest) => {
            return row.name;
          },
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created On" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 150,
        meta: {
          exportHeaderName: "Created On",
          exportValue: (row: ProcurementRequest) => {
            return formatDate(row.creation);
          },
        },
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const project = projectOptions.find(
            (i) => i.value === row.original.project
          );
          return (
            <div className="font-medium truncate" title={project?.label}>
              {project?.label || row.original.project}
            </div>
          );
        },
        enableColumnFilter: true,
        size: 200,
        meta: {
          enableFacet: true,
          facetTitle: "Project",
          exportHeaderName: "Project",
          exportValue: (row: ProcurementRequest) => {
            const project = projectOptions.find((i) => i.value === row.project);
            return project?.label || row.project;
          },
        },
      },
      {
        accessorKey: "work_package",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Package" />
        ),
        cell: ({ row }) => (
          <div className="font-medium truncate">
            {row.getValue("work_package") || "Custom"}
          </div>
        ),
        enableColumnFilter: true,
        size: 150,
        meta: {
          enableFacet: true,
          facetTitle: "Work Package",
          exportHeaderName: "Package",
          exportValue: (row: ProcurementRequest) => {
            return row.work_package || "--";
          },
        },
      },
      {
        accessorKey: "category_list",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Categories" />
        ),
        cell: ({ row }) => {
          const categories = row.getValue("category_list") as
            | { list: Category[] }
            | undefined;
          const categoryItems = Array.isArray(categories?.list)
            ? categories.list
            : [];
          return (
            <div className="flex flex-wrap gap-1 items-start justify-start">
              {categoryItems.length > 0
                ? categoryItems.map((obj) => (
                    <Badge key={obj.name} variant="outline" className="text-xs">
                      {obj.name}
                    </Badge>
                  ))
                : "--"}
            </div>
          );
        },
        size: 180,
        enableSorting: false,
        meta: {
          excludeFromExport: true,
        },
      },
      {
        accessorKey: "owner",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created By" />
        ),
        cell: ({ row }) => {
          const ownerUser = userList?.find(
            (entry) => row.original?.owner === entry.name
          );
          return (
            <div className="font-medium truncate">
              {ownerUser?.full_name || row.original?.owner || "--"}
            </div>
          );
        },
        size: 180,
        enableColumnFilter: true,
        meta: {
          exportHeaderName: "Created By",
          exportValue: (row: ProcurementRequest) => {
            const ownerUser = userList?.find(
              (entry) => row.owner === entry.name
            );
            return ownerUser?.full_name || row.owner || "--";
          },
        },
      },
      {
        accessorKey: "target_value",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Est. Value (excl GST)"
          />
        ),
        cell: ({ row }) => {
          const targetValue: string =
            Math.round(row.getValue("target_value")) !== 0
              ? row.getValue("target_value")
              : "N/A";
          return (
            <div className="font-medium truncate">
              {targetValue === "N/A"
                ? targetValue
                : formatToRoundedIndianRupee(targetValue)}
            </div>
          );
        },
        size: 180,
        meta: {
          exportHeaderName: "Est. Value (excl GST)",
          exportValue: (row: ProcurementRequest) => {
            const targetValue: any =
              Math.round(row.target_value || 0) !== 0
                ? row.target_value
                : "N/A";
            return targetValue === "N/A"
              ? targetValue
              : formatToRoundedIndianRupee(targetValue);
          },
        },
      },
      // Removed Estimated Price column as per original component's commented-out code
    ],
    [
      notifications,
      projectOptions,
      workPackageOptions,
      userList,
      handleNewPRSeen,
    ]
  ); // Removed getTotal dependency

  // --- (6) UPDATED: Faceted Filter Options ---
  // --- Dynamic Facet Values ---

  // --- Use the Server Data Table Hook ---
  const {
    table,
    data,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    // globalFilter, setGlobalFilter,
    // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle, // Use item search state
    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    columnFilters,
    isRowSelectionActive,
    refetch,
  } = useServerDataTable<ProcurementRequest>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: fieldsToFetch,
    searchableFields: prSearchableFields,
    // globalSearchFieldList: globalSearchFields,
    // enableItemSearch: true, // Enable item search for PRs (searches procurement_list)
    urlSyncKey: URL_SYNC_KEY,
    defaultSort: "modified desc",
    enableRowSelection: false, // Enable for bulk actions
    additionalFilters: staticFilters, // Filter by workflow_state = Pending
  });

  // --- Dynamic Facet Values ---
  const {
    facetOptions: projectFacetOptions,
    isLoading: isProjectFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "project",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: true,
  });

  const { facetOptions: workPackageFacetOptions, isLoading: isWPFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "work_package",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  // --- (6) UPDATED: Faceted Filter Options ---
  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      },
      work_package: {
        title: "Package",
        options: workPackageFacetOptions,
        isLoading: isWPFacetLoading,
      },
      owner: { title: "Created By", options: userOptions },
    }),
    [
      projectFacetOptions,
      isProjectFacetLoading,
      workPackageFacetOptions,
      isWPFacetLoading,
      userOptions,
    ]
  );

  // --- Combined Loading State & Error Handling ---
  const isLoading = projectsLoading || userListLoading || wpLoading;
  const error = projectsError || userError || listError || wpError;

  if (error) {
    return <AlertDestructive error={error as Error} />;
  }

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
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <DataTable<ProcurementRequest>
          table={table}
          columns={columns}
          // data={data} // Data managed internally by table instance
          isLoading={listIsLoading}
          error={listError}
          totalCount={totalCount}
          searchFieldOptions={prSearchableFields}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          // globalFilterValue={globalFilter}
          // onGlobalFilterChange={setGlobalFilter}
          // searchPlaceholder="Search Pending PRs..." // Updated placeholder
          // showItemSearchToggle={showItemSearchToggle}
          // itemSearchConfig={{
          //     isEnabled: isItemSearchEnabled,
          //     toggle: toggleItemSearch,
          //     label: "Item Search"
          // }}
          facetFilterOptions={facetFilterOptions}
          dateFilterColumns={dateColumns}
          showExportButton={true} // Enable if needed
          onExport={"default"}
          getRowClassName={getRowClassName}
          // toolbarActions={<Button size="sm">Bulk Approve/Reject...</Button>} // Placeholder
        />
      )}
    </div>
  );
};

export default ApprovePR;
