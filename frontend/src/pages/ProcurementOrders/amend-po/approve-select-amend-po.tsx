import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
import { useFacetValues } from "@/hooks/useFacetValues";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import {
  NotificationType,
  useNotificationStore,
} from "@/zustand/useNotificationStore";

// --- Types ---
import {
  ProcurementOrder as ProcurementOrdersType,
  PurchaseOrderItem,
} from "@/types/NirmaanStack/ProcurementOrders";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "../../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "../../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import {
  DEFAULT_PO_FIELDS_TO_FETCH,
  PO_DATE_COLUMNS,
  PO_SEARCHABLE_FIELDS,
} from "../purchase-order/config/purchaseOrdersTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = "Procurement Orders";
const URL_SYNC_KEY = "po_amend_approve"; // Unique key for this table instance

// --- Component ---
export const ApproveSelectAmendPO: React.FC = () => {
  const { db } = useContext(FrappeContext) as FrappeConfig;

  const projectsFetchOptions = getProjectListOptions();

  // --- Generate Query Keys ---
  const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

  // --- Supporting Data & Hooks ---
  const {
    data: projects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useFrappeGetDocList<ProjectsType>(
    "Projects",
    projectsFetchOptions as GetDocListArgs<FrappeDoc<ProjectsType>>,
    projectQueryKey
  );
  const {
    data: vendorsList,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList();
  const {
    data: userList,
    isLoading: userListLoading,
    error: userError,
  } = useUsersList();
  const { notifications, mark_seen_notification } = useNotificationStore();

  // --- Memoized Calculations & Options ---
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

  // Updated getTotal to work with the data structure directly
  const getTotal = useMemo(
    () =>
      memoize((order: ProcurementOrdersType | undefined | null): number => {
        if (!order) return 0;
        let total = 0;
        const orderData = Array.isArray(order.order_list?.list)
          ? order.order_list.list
          : [];
        orderData.forEach((item) => {
          const price = item.quote;
          total += parseNumber(price * item.quantity);
        });
        // Add loading/freight if applicable for amended PO totals? Check requirements.
        // total += parseNumber(order.loading_charges) + parseNumber(order.freight_charges);
        return total;
      }),
    []
  );

  // --- Notification Handling ---
  const handleNewSeen = useCallback(
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
      ["status", "=", "PO Amendment"], // Filter specifically for "PO Amendment" status
    ],
    []
  );

  // --- Fields to Fetch ---
  const fieldsToFetch = useMemo(
    () =>
      DEFAULT_PO_FIELDS_TO_FETCH.concat([
        "creation",
        "modified",
        "order_list",
        "loading_charges",
        "freight_charges",
        "procurement_request",
      ]),
    []
  );

  // --- Date Filter Columns ---
  const dateColumns = PO_DATE_COLUMNS;

  const poSearchableFieldsOptions = useMemo(
    () =>
      PO_SEARCHABLE_FIELDS.concat([
        {
          value: "procurement_request",
          label: "PR ID",
          placeholder: "Search by PR ID...",
        },
        {
          value: "owner",
          label: "Created By",
          placeholder: "Search by Created By...",
        },
      ]),
    []
  );

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ProcurementOrdersType>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#PO" />
        ),
        cell: ({ row }) => {
          const data = row.original;
          const poId = data.name;
          const isNew = notifications.find(
            (item) =>
              item.docname === poId &&
              item.seen === "false" &&
              item.event_id === "po:amended" // Check correct event_id
          );
          return (
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleNewSeen(isNew)}
              className="font-medium flex items-center gap-2 relative group"
            >
              {isNew && (
                <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />
              )}
              {/* Ensure Link points to correct view/tab */}
              <Link
                className="underline hover:underline-offset-2 whitespace-nowrap"
                to={`/purchase-orders/${poId?.replaceAll(
                  "/",
                  "&="
                )}?tab=Approve Amended PO`}
              >
                {poId?.toUpperCase()}
              </Link>
              {/* Ensure order_list structure is correct for hover card */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDoc={data}
                  parentDoctype={"Procurement Orders"}
                  childTableName="items"
                />
              </div>
              {data?.custom === "true" && (
                <Badge className="text-xs">Custom</Badge>
              )}
            </div>
          );
        },
        size: 200,
      },
      {
        accessorKey: "procurement_request",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#PR" />
        ),
        cell: ({ row }) => (
          <div className="font-medium">
            {row.getValue("procurement_request")?.slice(-4) ?? "--"}
          </div>
        ), // Display last 4 of PR
        size: 100,
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
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => (
          <div
            className="font-medium truncate"
            title={row.original.project_name}
          >
            {row.original.project_name || row.original.project}
          </div>
        ),
        enableColumnFilter: true,
        size: 200,
      },
      {
        accessorKey: "vendor",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor" />
        ),
        cell: ({ row }) => (
          <div
            className="font-medium truncate"
            title={row.original.vendor_name}
          >
            {row.original.vendor_name || row.original.vendor}
          </div>
        ),
        enableColumnFilter: true,
        size: 200,
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
      },
      {
        id: "total_amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amount" />
        ),
        cell: ({ row }) => (
          <p className="font-medium pr-2">
            {formatToRoundedIndianRupee(row.original.total_amount)}
          </p>
        ),
        size: 150,
        enableSorting: false,
      },
    ],
    [
      notifications,
      projectOptions,
      vendorOptions,
      userList,
      handleNewSeen,
      getTotal,
    ]
  ); // Updated dependencies

  // --- Use the Server Data Table Hook ---
  const {
    table,
    data,
    totalCount,
    isLoading: listIsLoading,
    error: listError,

    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    isRowSelectionActive,
    // globalFilter, setGlobalFilter,
    // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
    refetch, // Get refetch function
    columnFilters, // Extract columnFilters
  } = useServerDataTable<ProcurementOrdersType>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: fieldsToFetch,
    searchableFields: poSearchableFieldsOptions,
    // globalSearchFieldList: globalSearchFields,
    // enableItemSearch: true, // Enable item search for amended POs
    urlSyncKey: URL_SYNC_KEY,
    defaultSort: "modified desc",
    enableRowSelection: false, // Enable selection for potential bulk approval/rejection
    additionalFilters: staticFilters, // Filter by "PO Amendment" status
    // requirePendingItems: false // No need for this specific filter here
  });

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

  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      },
      vendor: {
        title: "Vendor",
        options: vendorFacetOptions,
        isLoading: isVendorFacetLoading,
      },
    }),
    [
      projectFacetOptions,
      isProjectFacetLoading,
      vendorFacetOptions,
      isVendorFacetLoading,
    ]
  );

  // --- Combined Loading State & Error Handling ---
  const isLoading = projectsLoading || vendorsLoading || userListLoading;
  const error = projectsError || vendorsError || userError || listError;

  if (error) {
    return <AlertDestructive error={error} />;
  }

  // TODO: Implement actual bulk approve/reject actions using table.getSelectedRowModel()

  return (
    <div className="flex-1 md:space-y-4">
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <DataTable<ProcurementOrdersType>
          table={table}
          columns={columns}
          // data={data} // Data is internally managed by table instance from the hook
          isLoading={listIsLoading}
          error={listError}
          totalCount={totalCount}
          searchFieldOptions={poSearchableFieldsOptions}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          // globalFilterValue={globalFilter}
          // onGlobalFilterChange={setGlobalFilter}
          // searchPlaceholder="Search Amended POs..."
          // showItemSearchToggle={showItemSearchToggle}
          // itemSearchConfig={{
          //     isEnabled: isItemSearchEnabled,
          //     toggle: toggleItemSearch,
          //     label: "Item Search"
          // }}
          facetFilterOptions={facetFilterOptions}
          dateFilterColumns={dateColumns}
          showExportButton={true}
          onExport={"default"}
          // showExport={true} // Enable if needed
          // onExport={handleExport} // Define handleExport if needed
          // toolbarActions={<Button size="sm">Bulk Actions...</Button>} // Placeholder for future actions
        />
      )}
    </div>
  );
};

export default ApproveSelectAmendPO;
