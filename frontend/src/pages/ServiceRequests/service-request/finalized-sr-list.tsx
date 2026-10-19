import React, { useCallback, useContext, useMemo } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
  FacetDeclaration,
  FacetOverrides,
} from "@/components/data-table/facetConfig";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
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
import { SRRemarksPopover } from "@/pages/ServiceRequests/approved-sr/components/SRRemarksPopover";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { parseNumber } from "@/utils/parseNumber";
import {
  DEFAULT_SR_FIELDS_TO_FETCH,
  SR_DATE_COLUMNS,
  SR_SEARCHABLE_FIELDS,
} from "../config/srTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useUserData } from "@/hooks/useUserData";

// --- Constants ---

const DOCTYPE = "Service Requests";

interface FinalizedSRListProps {
  for_vendor?: string;
  vendorName?: string; // Vendor Name for meaningful export filename
  urlSyncKeySuffix?: string;
}

export const SR_GST_OPTIONS_MAP = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];

// --- Component ---
export const FinalizedSRList: React.FC<FinalizedSRListProps> = ({
  for_vendor = undefined,
  vendorName = undefined,
  urlSyncKeySuffix = "finalized",
}) => {
  const { role } = useUserData();
  const { db } = useContext(FrappeContext) as FrappeConfig;
  const { ceoHoldProjectIds } = useCEOHoldProjects();

  const urlSyncKey = useMemo(
    () => `sr_${urlSyncKeySuffix}`,
    [urlSyncKeySuffix]
  );

  const projectsFetchOptions = getProjectListOptions();
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

  // --- Static Filters for Finalized SRs ---
  const staticFilters = useMemo(() => {
    const filters: Array<[string, string, string | string[] | number]> = [
      ["status", "=", "Approved"],
      ["is_finalized", "=", 1], // Only finalized SRs
    ];
    if (for_vendor) {
      filters.push(["vendor", "=", for_vendor]);
    }
    return filters;
  }, [for_vendor]);

  // --- Fields to Fetch ---
  const fieldsToFetch = useMemo(
    () =>
      DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation",
        "modified",
        "work_order_items",
        "service_category_list",
        "total_amount",
        "amount_paid",
        "gst",
        "amount_invoiced",
        "amount_due",
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
              item.event_id === "sr:finalized"
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
              {role === "Nirmaan Project Manager Profile" ? (
                srId?.slice(-5)
              ) : (
                <Link
                  className="underline hover:underline-offset-2 whitespace-nowrap"
                  to={`/service-requests/${srId}?tab=finalized-sr`}
                >
                  {srId?.slice(-5)}
                </Link>
              )}
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
          exportHeaderName: "#WO",
          exportValue: (row: ServiceRequests) => row.name,
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created on" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 150,
        meta: {
          exportHeaderName: "Created on",
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
          facet: { field: "project", title: "Project" } satisfies FacetDeclaration,
          exportHeaderName: "Project",
          exportValue: (row: ServiceRequests) => {
            const project = projectOptions.find((p) => p.value === row.project);
            return project?.label || row.project;
          },
        },
      },
      {
        accessorKey: "vendor",
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
          facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
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
        accessorKey: "total_amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Total WO Value" />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2">
            {formatToRoundedIndianRupee(row.original.total_amount)}
          </div>
        ),
        enableColumnFilter: true,
        size: 120,
        meta: {
          exportHeaderName: "Total WO Value",
          exportValue: (row: ServiceRequests) => parseNumber(row.total_amount) || 0,
        },
      },
      {
        accessorKey: "gst",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Incl. GST" />
        ),
        cell: ({ row }) => (
          <Badge variant={row.original.gst === "true" ? "green" : "outline"}>
            {row.original.gst === "true" ? "YES" : "NO"}
          </Badge>
        ),
        enableColumnFilter: true,
        size: 120,
      },
      {
        accessorKey: "amount_paid",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amt. Paid" />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2">
            {formatToRoundedIndianRupee(row.original.amount_paid)}
          </div>
        ),
        enableColumnFilter: true,
        size: 120,
        meta: {
          exportHeaderName: "Amt. Paid",
          exportValue: (row: ServiceRequests) => parseNumber(row.amount_paid) || 0,
        },
      },
      {
        // A stored SR field (total_amount - amount_paid, maintained by the same events
        // that write its operands), so the database orders the whole set.
        accessorKey: "amount_due",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amount Due" />
        ),
        cell: ({ row }) => {
          const value = parseNumber(row.original.amount_due);
          return (
            <div className={cn("font-medium pr-2", value < 0 ? "text-red-600" : "text-amber-600")}>
              {formatToRoundedIndianRupee(value)}
            </div>
          );
        },
        enableSorting: true,
        size: 150,
        meta: {
          exportHeaderName: "Amount Due",
          exportValue: (row: ServiceRequests) => parseNumber(row.amount_due),
        },
      },
      {
        // A stored SR field, so the id IS the backend field name and `order_by` works:
        // the database orders the whole set, not just the fetched page.
        accessorKey: "amount_invoiced",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Total Invoiced"
            className="justify-end"
          />
        ),
        cell: ({ row }) => {
          const invoiceTotal = parseNumber(row.original.amount_invoiced);
          return (
            <div className="text-center font-medium text-blue-600">
              {formatToRoundedIndianRupee(invoiceTotal)}
            </div>
          );
        },
        size: 150,
        enableSorting: true,
        meta: {
          exportHeaderName: "Total Invoiced",
          exportValue: (row: ServiceRequests) => parseNumber(row.amount_invoiced),
        },
      },
      {
        id: "remarks",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Remarks" />
        ),
        cell: ({ row }) => <SRRemarksPopover srId={row.original.name} />,
        size: 100,
        enableSorting: false,
      },
    ],
    [
      notifications,
      projectOptions,
      vendorOptions,
      userList,
      handleNewSRSeen,
      getVendorName,
      for_vendor,
    ]
  );

  // --- Server Data Table Hook ---
  const {
    table,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    exportAllRows,
    isExporting,
  } = useServerDataTable<ServiceRequests>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: fieldsToFetch,
    searchableFields: srSearchableFields,
    urlSyncKey: urlSyncKey,
    defaultSort: "modified desc",
    enableRowSelection: true,
    additionalFilters: staticFilters,
    // The client-side sort only orders the CURRENT PAGE, so the vendor tab - where a
    // single vendor's whole work-order list normally fits - gets a large page. The
    // standalone Service Requests page keeps the default.
  });

  // --- Static Faceted Filter Options ---
  // `project` + `vendor` migrated to the self-fetching facet path (meta.facet +
  // facetDoctype/facetOverrides). `gst` stays a static (non-self-fetching) facet.
  const facetFilterOptions = useMemo(
    () => ({
      gst: { title: "GST", options: SR_GST_OPTIONS_MAP },
    }),
    []
  );

  // --- Combined Loading & Error States ---
  const isLoading =
    projectsLoading ||
    vendorsLoading ||
    userListLoading;
  const combinedError =
    projectsError ||
    vendorsError ||
    userError ||
    listError;

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
        <>
          <Alert className="bg-blue-50 border-blue-200 mb-2">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              <strong>Note:</strong> Amount Due = Total WO Value − Amt Paid
            </AlertDescription>
          </Alert>
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
            facetDoctype={DOCTYPE}
            facetOverrides={{
              project: { additionalFilters: staticFilters },
              vendor: { additionalFilters: staticFilters, enabled: !for_vendor },
            } satisfies FacetOverrides}
            facetFilterOptions={facetFilterOptions}
            dateFilterColumns={dateColumns}
            showExportButton={true}
            onExport={"default"}
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName={
              vendorName ? `${vendorName}_Finalized_WO_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}` : `Finalized_WO_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}`
            }
            getRowClassName={getRowClassName}
          />
        </>
      )}
    </div>
  );
};

export default FinalizedSRList;
