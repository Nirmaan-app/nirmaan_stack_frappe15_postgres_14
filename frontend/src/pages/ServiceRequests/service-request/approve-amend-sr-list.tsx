import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { cn } from "@/lib/utils";
import { ColumnDef, Row } from "@tanstack/react-table";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import { Link } from "react-router-dom";
import {
  useFrappeGetDocList,
  FrappeContext,
  FrappeConfig,
  FrappeDoc,
  GetDocListArgs,
} from "frappe-react-sdk";
import memoize from "lodash/memoize";

// --- UI Components ---
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import {
  NotificationType,
  useNotificationStore,
} from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import {
  DEFAULT_SR_FIELDS_TO_FETCH,
  SR_DATE_COLUMNS,
  SR_SEARCHABLE_FIELDS,
} from "../config/srTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = "Service Requests";
const URL_SYNC_KEY = "sr_amend_approve"; // Unique key for this table instance

// The amended totals, as the server works them out (`print_totals.get_amended_totals`): the stored
// `total_amount` is still the one from before the amendment until it is accepted. Never a browser figure
// (frontend/CODING_STANDARDS.md § Displaying money): a row without its server figure shows a placeholder.
const AMENDED_TOTALS_METHOD = "nirmaan_stack.api.service_requests.print_totals.get_amended_totals";
const AMENDED_VALUE_PLACEHOLDER = "…";

/** A row as exported: the list's fields plus its server amended total. */
type AmendedRow = ServiceRequests & { amended_total?: number };

/** The current page's amended totals: fetched once the page's rows are known, which is after the columns are
 *  built, so the cell reads them from context rather than from the columns' closure. */
const AmendedTotalsContext = createContext<Record<string, number> | undefined>(undefined);

const AmendedValueCell: React.FC<{ name: string }> = ({ name }) => {
  const total = useContext(AmendedTotalsContext)?.[name];
  return (
    <p className="font-medium pr-2">
      {total === undefined ? AMENDED_VALUE_PLACEHOLDER : formatToRoundedIndianRupee(total)}
    </p>
  );
};

// --- Component ---
export const ApproveSelectAmendSR: React.FC = () => {
  const { db, call } = useContext(FrappeContext) as FrappeConfig;
  const { ceoHoldProjectIds } = useCEOHoldProjects();

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
    data: vendorsList,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList({ vendorTypes: ["Service", "Material & Service"] });
  const {
    data: userList,
    isLoading: userListLoading,
    error: userError,
  } = useUsersList();
  const { notifications, mark_seen_notification } = useNotificationStore();

  // --- Memoized Options & Calculations ---
  const projectOptions = useMemo(
    () =>
      projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
      })) || [],
    [projects]
  );
  const vendorOptions = useMemo(
    () =>
      vendorsList?.map((ven) => ({
        label: ven.vendor_name,
        value: ven.name,
      })) || [],
    [vendorsList]
  );

  const getVendorName = useCallback(
    memoize((vendorId: string | undefined): string => {
      return (
        vendorsList?.find((vendor) => vendor.name === vendorId)?.vendor_name ||
        vendorId ||
        "--"
      );
    }),
    [vendorsList]
  );

  // --- Notification Handling ---
  const handleNewSRSeen = useCallback(
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
      ["status", "=", "Amendment"], // Filter for SRs in "Amendment" status
    ],
    []
  );

  // --- Fields to Fetch ---
  const fieldsToFetch = useMemo(
    () =>
      DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation",
        "modified",
        "work_order_items",
        "service_category_list",
      ]),
    []
  );

  const srSearchableFields = useMemo(
    () =>
      SR_SEARCHABLE_FIELDS.concat([
        {
          value: "owner",
          label: "Created By",
          placeholder: "Search by Created By...",
        },
      ]),
    []
  );

  // --- Date Filter Columns ---
  const dateColumns = useMemo(() => SR_DATE_COLUMNS, []);

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ServiceRequests>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#WO" />
        ),
        cell: ({ row }) => {
          const data = row.original;
          const srId = data.name;
          const isNew = notifications.find(
            (item) =>
              item.docname === srId &&
              item.seen === "false" &&
              item.event_id === "sr:amended" // Ensure correct event_id
          );
          return (
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleNewSRSeen(isNew)}
              className="font-medium flex items-center gap-2 relative group"
            >
              {isNew && (
                <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />
              )}
              {/* Link to the page where Amended SR can be approved */}
              <Link
                className="underline hover:underline-offset-2 whitespace-nowrap"
                to={`/service-requests/${srId}?tab=approve-amended-so`}
              >
                {srId?.slice(-5)}
              </Link>
              <div className="opacity-90 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDoc={data}
                  parentDoctype="Service Requests"
                  childTableName="work_order_items"
                  isSR
                />
              </div>
            </div>
          );
        },
        size: 150,
        meta: {
          exportHeaderName: "SR ID",
          exportValue: (row: ServiceRequests) => row.name,
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
          exportValue: (row: ServiceRequests) => formatDate(row.creation),
        },
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const project = projectOptions.find(
            (p) => p.value === row.original.project
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
          facet: {
            field: "project",
            title: "Project",
          } satisfies FacetDeclaration,
          exportHeaderName: "Project",
          exportValue: (row: ServiceRequests) => {
            const project = projectOptions.find((p) => p.value === row.project);
            return project?.label || row.project;
          },
        },
      },
      {
        accessorKey: "vendor", // Filter by vendor ID
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor" />
        ),
        cell: ({ row }) => (
          <div
            className="font-medium truncate"
            title={getVendorName(row.original.vendor)}
          >
            {getVendorName(row.original.vendor)}
          </div>
        ),
        enableColumnFilter: true,
        size: 200,
        meta: {
          facet: {
            field: "vendor",
            title: "Vendor",
          } satisfies FacetDeclaration,
          exportHeaderName: "Vendor",
          exportValue: (row: ServiceRequests) => getVendorName(row.vendor),
        },
      },
      {
        accessorKey: "service_category_list",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Categories" />
        ),
        cell: ({ row }) => {
          const categories = row.getValue("service_category_list") as
            | { list: { name: string }[] }
            | undefined;
          const categoryItems = Array.isArray(categories?.list)
            ? categories.list
            : [];
          return (
            <div className="flex flex-wrap gap-1 items-start justify-start max-w-[200px]">
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
          exportHeaderName: "Categories",
          exportValue: (row: ServiceRequests) => {
            const categories = row.service_category_list as
              | { list: { name: string }[] }
              | undefined;
            return Array.isArray(categories?.list)
              ? categories.list.map((c) => c.name).join(", ")
              : "--";
          },
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
        meta: {
          exportHeaderName: "Created By",
          exportValue: (row: ServiceRequests) => {
            const ownerUser = userList?.find(
              (entry) => row.owner === entry.name
            );
            return ownerUser?.full_name || row.owner || "--";
          },
        },
      },
      {
        id: "amended_sr_value",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amended Value" />
        ),
        cell: ({ row }) => <AmendedValueCell name={row.original.name} />,
        size: 150,
        enableSorting: false,
        meta: {
          exportHeaderName: "Amended Value",
          exportValue: (row: AmendedRow) =>
            row.amended_total === undefined ? "" : formatForReport(row.amended_total),
        },
      },
    ],
    [
      notifications,
      projectOptions,
      vendorOptions,
      userList,
      handleNewSRSeen,
      getVendorName,
    ]
  );

  // --- (MOVED UP) Use the Server Data Table Hook ---
  const {
    table,
    data,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    // globalFilter, setGlobalFilter,
    // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    isRowSelectionActive,
    refetch,
    exportAllRows,
    isExporting,
  } = useServerDataTable<ServiceRequests>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: fieldsToFetch,
    searchableFields: srSearchableFields,
    // globalSearchFieldList: globalSearchFields,
    // enableItemSearch: true, // If searching within service_order_list is needed
    urlSyncKey: URL_SYNC_KEY,
    defaultSort: "modified desc",
    enableRowSelection: false, // For bulk approval
    additionalFilters: staticFilters,
  });

  const pageNames = useMemo(() => (data || []).map((row) => row.name).sort(), [data]);
  const { data: amendedTotals } = useFrappeGetCall<{ message: Record<string, number> }>(
    AMENDED_TOTALS_METHOD,
    { work_orders: JSON.stringify(pageNames) },
    pageNames.length ? `AmendedTotals-${pageNames.join(",")}` : null
  );

  // Export All: every exported row carries its server amended total, not only the current page's.
  const exportAllRowsWithAmendedTotals = useCallback(async (): Promise<AmendedRow[]> => {
    const rows = await exportAllRows();
    if (!rows.length) return rows;
    const totals: { message: Record<string, number> } = await call.get(AMENDED_TOTALS_METHOD, {
      work_orders: JSON.stringify(rows.map((row) => row.name)),
    });
    return rows.map((row) => ({ ...row, amended_total: totals.message?.[row.name] }));
  }, [exportAllRows, call]);

  // --- Combined Loading & Error States ---
  const isLoading = projectsLoading || vendorsLoading || userListLoading;
  const combinedError = projectsError || vendorsError || userError || listError;

  // --- CEO Hold Row Highlighting ---
  const getRowClassName = useCallback(
    (row: Row<ServiceRequests>) => {
      const projectId = row.original.project;
      if (projectId && ceoHoldProjectIds.has(projectId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      return undefined;
    },
    [ceoHoldProjectIds]
  );

  if (combinedError) {
    return <AlertDestructive error={combinedError} />;
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
        <AmendedTotalsContext.Provider value={amendedTotals?.message}>
        <DataTable<ServiceRequests>
          table={table}
          columns={columns}
          isLoading={listIsLoading}
          error={listError}
          totalCount={totalCount}
          searchFieldOptions={srSearchableFields}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          // globalFilterValue={globalFilter}
          // onGlobalFilterChange={setGlobalFilter}
          // searchPlaceholder="Search Amended SRs..."
          // showItemSearchToggle={showItemSearchToggle}
          // itemSearchConfig={{
          //     isEnabled: isItemSearchEnabled,
          //     toggle: toggleItemSearch,
          //     label: "Service Item Search"
          // }}
          facetDoctype={DOCTYPE}
          facetOverrides={{
            project: { additionalFilters: staticFilters },
            vendor: { additionalFilters: staticFilters },
          }}
          dateFilterColumns={dateColumns}
          showExportButton={true} // Enable if needed
          onExport={"default"}
          onExportAll={exportAllRowsWithAmendedTotals}
          isExporting={isExporting}
          exportFileName={`Approve_Amended_WO_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}`}
          getRowClassName={getRowClassName}
          // toolbarActions={<Button size="sm">Bulk Approve Amended...</Button>} // Placeholder
        />
        </AmendedTotalsContext.Provider>
      )}
    </div>
  );
};

export default ApproveSelectAmendSR;
