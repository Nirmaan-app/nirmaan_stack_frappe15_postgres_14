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
import { useFacetValues } from "@/hooks/useFacetValues";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
  NotificationType,
  useNotificationStore,
} from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
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
import { useDocCountStore } from "@/zustand/useDocCountStore";

// --- Constants ---
const DOCTYPE = "Service Requests";

interface AllSRListProps {
  for_vendor?: string;
  vendorName?: string;
  urlSyncKeySuffix?: string;
}

export const SR_GST_OPTIONS_MAP = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];

export const AllSRList: React.FC<AllSRListProps> = ({
  for_vendor = undefined,
  vendorName = undefined,
  urlSyncKeySuffix = "all_wo",
}) => {
  const { role } = useUserData();
  const { db } = useContext(FrappeContext) as FrappeConfig;
  const { ceoHoldProjectIds } = useCEOHoldProjects();
  const { counts } = useDocCountStore();

  const urlSyncKey = useMemo(
    () => `sr_${urlSyncKeySuffix}_all`,
    [urlSyncKeySuffix]
  );

  const projectsFetchOptions = getProjectListOptions();
  const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

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

  const vendorInvoiceFilters = useMemo(() => {
    const filters: Array<[string, string, string | string[]]> = [
      ["document_type", "=", "Service Requests"],
      ["status", "=", "Approved"],
    ];
    if (for_vendor) {
      filters.push(["vendor", "=", for_vendor]);
    }
    return filters;
  }, [for_vendor]);

  const { data: vendorInvoices } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      filters: vendorInvoiceFilters,
      fields: ["name", "document_name", "invoice_amount"],
      limit: 0,
    } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
    `VendorInvoices-SR-all-${for_vendor || "all"}`
  );

  const { notifications, mark_seen_notification } = useNotificationStore();

  const projectOptions = useMemo(
    () =>
      projects?.map((item) => ({
        label: item.project_name,
        value: item.name,
      })) || [],
    [projects]
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

  const invoiceTotalsMap = useMemo(() => {
    if (!vendorInvoices) return new Map<string, number>();
    return vendorInvoices.reduce((acc, inv) => {
      const current = acc.get(inv.document_name) ?? 0;
      acc.set(inv.document_name, current + parseNumber(inv.invoice_amount));
      return acc;
    }, new Map<string, number>());
  }, [vendorInvoices]);

  const handleNewSRSeen = useCallback(
    (notification: NotificationType | undefined) => {
      if (notification && notification.seen === "false") {
        mark_seen_notification(db, notification);
      }
    },
    [db, mark_seen_notification]
  );

  const staticFilters = useMemo(() => {
    const filters: Array<[string, string, any]> = [
      ["status", "=", "Approved"],
    ];

    if (for_vendor) {
      filters.push(["vendor", "=", for_vendor]);
    }
    return filters;
  }, [for_vendor]);

  const fieldsToFetch = useMemo(
    () =>
      DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation",
        "modified",
        "service_order_list",
        "service_category_list",
        "total_amount",
        "amount_paid",
        "gst",
        "is_finalized"
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
              (item.event_id === "sr:approved" || item.event_id === "sr:finalized")
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
                  to={`/service-requests/${srId}?tab=${data.is_finalized ? 'finalized-sr' : 'approved-sr'}`}
                >
                  {srId?.slice(-5)}
                </Link>
              )}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDoc={data}
                  parentDoctype="Service Requests"
                  childTableName="service_order_list"
                  isSR
                />
              </div>
            </div>
          );
        },
        size: 150,
        meta: { exportHeaderName: "#WO", exportValue: (row: ServiceRequests) => row.name },
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
        meta: { exportHeaderName: "Created on", exportValue: (row: ServiceRequests) => formatDate(row.creation) },
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const project = projectOptions.find((p) => p.value === row.original.project);
          return (
            <div className="font-medium truncate" title={project?.label}>
              {project?.label || row.original.project}
            </div>
          );
        },
        enableColumnFilter: true,
        size: 200,
        meta: {
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
          <div className="font-medium truncate" title={getVendorName(row.original.vendor)}>
            {getVendorName(row.original.vendor)}
          </div>
        ),
        enableColumnFilter: true,
        size: 200,
        meta: { exportHeaderName: "Vendor", exportValue: (row: ServiceRequests) => getVendorName(row.vendor) },
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
        accessorKey: "is_finalized",
        header: ({ column }: { column: any }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }: { row: any }) => (
          <Badge variant={row.getValue("is_finalized") ? "green" : "outline"}>
            {row.getValue("is_finalized") ? "Finalized" : "Approved"}
          </Badge>
        ),
        enableColumnFilter: true,
        size: 120,
        meta: {
          enableFacet: true,
          facetTitle: "Status",
        }
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
        meta: { exportHeaderName: "Total WO Value", exportValue: (row: ServiceRequests) => parseNumber(row.total_amount) || 0 },
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
        meta: { exportHeaderName: "Amt. Paid", exportValue: (row: ServiceRequests) => parseNumber(row.amount_paid) || 0 },
      },
      {
        id: "amount_due",
        header: "Amount Due",
        cell: ({ row }) => {
          const total = parseNumber(row.original.total_amount) || 0;
          const paid = parseNumber(row.original.amount_paid) || 0;
          const value = total - paid;
          return (
            <div className={cn("font-medium pr-2", value < 0 ? "text-red-600" : "text-amber-600")}>
              {formatToRoundedIndianRupee(value)}
            </div>
          );
        },
        enableSorting: false,
        size: 150,
        meta: {
          exportHeaderName: "Amount Due",
          exportValue: (row: ServiceRequests) => {
            const total = parseNumber(row.total_amount) || 0;
            const paid = parseNumber(row.amount_paid) || 0;
            return total - paid;
          },
        },
      },
      {
        id: "total_invoiced",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Total Invoiced" className="justify-end" />
        ),
        cell: ({ row }) => {
          const invoiceTotal = invoiceTotalsMap.get(row.original.name) ?? 0;
          return (
            <div className="text-center font-medium text-blue-600">
              {formatToRoundedIndianRupee(invoiceTotal)}
            </div>
          );
        },
        size: 150,
        enableSorting: false,
        meta: { exportHeaderName: "Total Invoiced", exportValue: (row: ServiceRequests) => invoiceTotalsMap.get(row.name) ?? 0 },
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
    [notifications, projectOptions, getVendorName, handleNewSRSeen, invoiceTotalsMap, role, for_vendor]
  );

  const {
    table,
    data: serviceRequestsData,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    columnFilters,
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
  });

  const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
    doctype: DOCTYPE,
    field: "project",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: true,
  });

  const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } = useFacetValues({
    doctype: DOCTYPE,
    field: "vendor",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: !for_vendor,
  });

  const { facetOptions: finalizedFacetOptions, isLoading: isFinalizedFacetLoading } = useFacetValues({
    doctype: DOCTYPE,
    field: "is_finalized",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: true,
  });

  const memoizedStatusOptions = useMemo(() => {
    const baseOptions: { label: string; value: string; count?: number }[] = [
      { label: "Approved", value: "0" },
      { label: "Finalized", value: "1" },
    ];
    return baseOptions.map((baseOpt) => {
      const facetOpt = (finalizedFacetOptions as any[])?.find((f) => String(f.value) === baseOpt.value);
      return {
        ...baseOpt,
        count: facetOpt?.count ?? 0,
      };
    });
  }, [finalizedFacetOptions]);

  const facetFilterOptions = useMemo(
    () => ({
      vendor: { title: "Vendor", options: vendorFacetOptions, isLoading: isVendorFacetLoading },
      project: { title: "Project", options: projectFacetOptions, isLoading: isProjectFacetLoading },
      is_finalized: {
        title: "Status",
        options: memoizedStatusOptions,
        isLoading: isFinalizedFacetLoading,
      },
      gst: { title: "GST", options: SR_GST_OPTIONS_MAP },
    }),
    [vendorFacetOptions, isVendorFacetLoading, projectFacetOptions, isProjectFacetLoading, memoizedStatusOptions, isFinalizedFacetLoading]
  );

  const isLoadingOverall = projectsLoading || vendorsLoading || listIsLoading;
  const combinedError = projectsError || vendorsError || listError;

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

  if (combinedError) return <AlertDestructive error={combinedError} />;

  return (
    <div className="flex-1 space-y-4">
      <div className={cn("flex flex-col gap-2 overflow-hidden", totalCount > 10 ? "h-[calc(100vh-120px)]" : "h-auto")}>
        {isLoadingOverall && !serviceRequestsData?.length ? (
          <TableSkeleton />
        ) : (
          <>
            <Alert className="bg-blue-50 border-blue-200 mb-2">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                <strong>Note:</strong> Showing All Work Orders | Amount Due = Total WO Value − Amt Paid
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
              facetFilterOptions={facetFilterOptions}
              dateFilterColumns={SR_DATE_COLUMNS}
              showExportButton={true}
              onExport={"default"}
              onExportAll={exportAllRows}
              isExporting={isExporting}
              exportFileName={
                vendorName ? `${vendorName}_All_WO_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}` : `All_WO_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}`
              }
              getRowClassName={getRowClassName}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default AllSRList;
