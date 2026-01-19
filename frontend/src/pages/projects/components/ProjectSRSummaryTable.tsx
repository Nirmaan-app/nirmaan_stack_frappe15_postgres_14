import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import memoize from "lodash/memoize";

// --- UI Components ---
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import {
  ServiceItemType,
  ServiceRequests,
} from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList"; // Adjust path
import { TailSpin } from "react-loader-spinner";
import { useOrderPayments } from "@/hooks/useOrderPayments";

// Fields to fetch for the SR Summary table list view
export const SR_SUMMARY_LIST_FIELDS_TO_FETCH: (
  | keyof ServiceRequests
  | "name"
)[] = [
  "name",
  "creation",
  "modified",
  "owner",
  "project",
  "vendor",
  "service_category_list",
  "status",
  "service_order_list",
  "gst",
  "total_amount",
  "amount_paid",
];

// Searchable fields for the SR Summary table
export const SR_SUMMARY_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "name",
    label: "WO #",
    placeholder: "Search by WO #...",
    default: true,
  },
  // { value: "project_name", label: "Project", placeholder: "Search by Project..." }, // Already filtered by project
  // { value: "vendor_name", label: "Vendor", placeholder: "Search by Vendor..." }, // If vendor is relevant here
  { value: "status", label: "Status", placeholder: "Search by Status..." },
  {
    value: "service_order_list",
    label: "Service Item",
    placeholder: "Search by Service Item...",
    is_json: true,
  },
];

// Date columns for the SR Summary table
export const SR_SUMMARY_DATE_COLUMNS: string[] = ["creation", "modified"];

// Status options for faceted filter if needed
export const SR_SUMMARY_STATUS_OPTIONS = [
  { label: "Approved", value: "Approved" },
  { label: "Vendor Selected", value: "Vendor Selected" },
  { label: "Created", value: "Created" },
  { label: "Amendment", value: "Amendment" },
  // { label: "Edit", value: "Edit" },
  { label: "Rejected", value: "Rejected" },
];

export const SR_SUMMARY_GST_OPTIONS_MAP = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" },
];
// --- Constants ---
const DOCTYPE = "Service Requests"; // Main Doctype for the list

interface ProjectSRSummaryTableProps {
  projectId: string | undefined;
  hideSummaryCard?: boolean;
  hideFinancialColumns?: boolean;
}

interface SRAggregates {
  total_sr_value_inc_gst: number;
  total_sr_value_excl_gst: number;
  total_amount_paid_for_srs: number;
}

// --- Component ---
export const ProjectSRSummaryTable: React.FC<ProjectSRSummaryTableProps> = ({
  projectId,
  hideSummaryCard = false,
  hideFinancialColumns = false,
}) => {
  const { toast } = useToast();

  // --- URL Key for this specific table instance ---
  const urlSyncKey = useMemo(
    () => `prj_sr_summary_${projectId || "all"}`,
    [projectId]
  );

  const [srAggregates, setSRAggregates] = useState<SRAggregates>({
    total_sr_value_inc_gst: 0,
    total_sr_value_excl_gst: 0,
    total_amount_paid_for_srs: 0,
  });

  // --- Fetch Aggregates (Totals) ---
  const {
    call: fetchSRAggregates,
    loading: aggregatesLoading,
    error: aggregatesError,
  } = useFrappePostCall<{ message: SRAggregates }>(
    "nirmaan_stack.api.projects.project_aggregates.get_project_sr_summary_aggregates"
  );

  useEffect(() => {
    if (projectId) {
      fetchSRAggregates({ project_id: projectId })
        .then((res) => setSRAggregates((prev) => ({ ...prev, ...res.message }))) // Merge with defaults
        .catch((err) =>
          console.error("Failed to fetch PR statuses data:", err)
        );
    } else {
      // Reset counts if no projectId (e.g., if component can be shown for all projects)
      setSRAggregates({
        total_sr_value_inc_gst: 0,
        total_sr_value_excl_gst: 0,
        total_amount_paid_for_srs: 0,
      });
    }
  }, [projectId, fetchSRAggregates]);

  // --- Supporting Data (for display in columns/facets, not for main list filtering) ---
  const { data: projects, isLoading: projectsLoading } =
    useFrappeGetDocList<Projects>(
      "Projects",
      {
        fields: ["name", "project_name"],
        filters: projectId ? [["name", "=", projectId]] : [],
        limit: projectId ? 1 : 1000,
      },
      `ProjectForSRSummary_${projectId || "all"}`
    );
  const {
    data: vendorsList,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList({ vendorTypes: ["Service", "Material & Service"] });

  // const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();

  // --- Memoized Lookups ---
  const getProjectName = useCallback(
    memoize(
      (projId?: string) =>
        projects?.find((p) => p.name === projId)?.project_name || projId || "--"
    ),
    [projects]
  );

  const getVendorName = useCallback(
    memoize(
      (vendorId?: string) =>
        vendorsList?.find((v) => v.name === vendorId)?.vendor_name ||
        vendorId ||
        "--"
    ),
    [vendorsList]
  );

  // --- Static Filters for useServerDataTable (based on projectId) ---
  const staticFilters = useMemo(() => {
    const filters: Array<[string, string, any]> = [];
    if (projectId) {
      filters.push(["project", "=", projectId]);
    }
    // // Could add other default static filters here, e.g., status "Approved" for this summary
    // filters.push(["status", "=", "Approved"]);
    return filters;
  }, [projectId]);

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ServiceRequests>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="WO #" />
        ),
        cell: ({ row }) => {
          const sr = row.original;
          return (
            <div className="font-medium flex items-center gap-1 group">
              <Link
                className="text-blue-600 hover:underline whitespace-nowrap"
                to={`/service-requests-list/${sr.name}`}
              >
                {sr.name?.slice(-5)}
              </Link>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDoc={sr}
                  parentDoctype="Service Requests"
                  childTableName="service_order_list"
                  isSR
                />
              </div>
            </div>
          );
        },
        size: 150,
        meta: {
          exportHeaderName: "WO ID",
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SR Creation Date" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 150,
        meta: {
          exportHeaderName: "SR Creation Date",
        },
      },
      // Project column might be redundant if table is already filtered by projectId
      ...(!projectId
        ? [
            {
              accessorKey: "project",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Project" />
              ),
              cell: ({ row }) => (
                <div
                  className="font-medium truncate"
                  title={getProjectName(row.original.project)}
                >
                  {getProjectName(row.original.project)}
                </div>
              ),
              enableColumnFilter: true,
              size: 180,
            } as ColumnDef<ServiceRequests>,
          ]
        : []),
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
        size: 180,
        meta: {
          exportHeaderName: "Vendor",
          exportValue: (row: ServiceRequests) => {
            return getVendorName(row.vendor);
          },
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "Approved" ? "green" : "outline"}
          >
            {row.original.status}
          </Badge>
        ), // Example badge
        enableColumnFilter: true,
        size: 120,
      },
      // Financial columns - conditionally included based on hideFinancialColumns prop
      ...(!hideFinancialColumns
        ? [
            {
              accessorKey: "total_amount",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Total SR Value" />
              ),
              cell: ({ row }) => (
                <div className="font-medium pr-2">
                  {formatToRoundedIndianRupee(row.original.total_amount)}
                </div>
              ),
              enableColumnFilter: true,
              size: 120,
            } as ColumnDef<ServiceRequests>,
            {
              accessorKey: "gst",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Incl. GST" />
              ),
              cell: ({ row }) => (
                <Badge variant={row.original.gst === "true" ? "green" : "outline"}>
                  {row.original.gst === "true" ? "Yes" : "No"}
                </Badge>
              ),
              enableColumnFilter: true,
              size: 120,
            } as ColumnDef<ServiceRequests>,
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
            } as ColumnDef<ServiceRequests>,
            {
              id: "amount_payable",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Amt payable" />
              ),
              cell: ({ row }) => (
                <div className="font-medium pr-2">
                  {formatToRoundedIndianRupee(
                    parseNumber(row.original.total_amount) -
                      parseNumber(row.original.amount_paid)
                  )}
                </div>
              ),
              enableColumnFilter: true,
              size: 120,
              meta: {
                exportHeaderName: "Amt payable",
                exportValue: (row: ServiceRequests) => {
                  return formatToRoundedIndianRupee(
                    parseNumber(row.total_amount) - parseNumber(row.amount_paid)
                  );
                },
              },
            } as ColumnDef<ServiceRequests>,
          ]
        : []),
    ],
    [projectId, getProjectName, getVendorName, hideFinancialColumns]
  ); //,getSRRowTotal, getTotalAmountPaidForSR]);

  // --- useServerDataTable Hook for the paginated SR list ---
  const {
    table,
    data: serviceRequestsData,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    columnFilters,
  } = useServerDataTable<ServiceRequests>({
    doctype: DOCTYPE,
    columns: columns, // Columns are defined below using `useMemo`
    fetchFields: SR_SUMMARY_LIST_FIELDS_TO_FETCH as string[],
    searchableFields: SR_SUMMARY_SEARCHABLE_FIELDS,
    urlSyncKey: urlSyncKey,
    defaultSort: "modified desc",
    enableRowSelection: false, // No selection typically needed for summary
    additionalFilters: staticFilters,
  });

  // --- Dynamic Facet Values ---
  const { facetOptions: statusFacetOptions, isLoading: isStatusFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "status",
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

  const { facetOptions: gstFacetOptions, isLoading: isGstFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "gst",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters,
      enabled: true,
    });

  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(() => {
    const opts: any = {
      status: {
        title: "Status",
        options: statusFacetOptions,
        isLoading: isStatusFacetLoading,
      },
      vendor: {
        title: "Vendor",
        options: vendorFacetOptions,
        isLoading: isVendorFacetLoading,
      },
      gst: {
        title: "GST",
        options: gstFacetOptions,
        isLoading: isGstFacetLoading,
      },
    };
    // if (!projectId) { // Only add project facet if not already filtered by a single project
    //     opts.project = { title: "Project", options: projectOptions };
    // }
    return opts;
  }, [
    statusFacetOptions,
    isStatusFacetLoading,
    vendorFacetOptions,
    isVendorFacetLoading,
    gstFacetOptions,
    isGstFacetLoading,
    projectId,
  ]);

  // --- Combined Loading & Error States ---
  const isInitialLoading =
    projectsLoading || vendorsLoading || aggregatesLoading;

  const combinedError = vendorsError || listError || aggregatesError;

  if (combinedError && !serviceRequestsData?.length) {
    // Show error if main list fails
    toast({
      title: "Error Loading SR Summary",
      description: combinedError.message,
      variant: "destructive",
    });
  }

  return (
    <div className="space-y-4">
      {!hideSummaryCard && (
        <Card>
          <CardContent className="flex flex-row items-center justify-between p-4">
            <CardDescription>
              <p className="text-lg font-semibold text-gray-700">
                WO Summary
                {/* ({getProjectName(projectId) || "All Projects"}) */}
              </p>
              <p className="text-sm text-gray-500">
                Overview of Approved Service Request totals
              </p>
            </CardDescription>
            <CardDescription className="text-right">
              {aggregatesLoading ? (
                <TailSpin height={20} width={20} />
              ) : aggregatesError ? (
                <span className="text-xs text-destructive">
                  Error loading totals
                </span>
              ) : (
                <div className="flex flex-col items-end text-sm">
                  <p className="text-gray-700">
                    <span className="font-medium">Total Value (inc. GST):</span>{" "}
                    <span className="text-blue-600 font-semibold">
                      {formatToRoundedIndianRupee(
                        srAggregates.total_sr_value_inc_gst
                      )}
                    </span>
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium">Total Amt Paid:</span>{" "}
                    <span className="text-green-600 font-semibold">
                      {formatToRoundedIndianRupee(
                        srAggregates.total_amount_paid_for_srs
                      )}
                    </span>
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium">Total Amt Payable:</span>{" "}
                    <span className="text-yellow-600 font-semibold">
                      {formatToRoundedIndianRupee(
                        srAggregates.total_sr_value_inc_gst -
                          srAggregates.total_amount_paid_for_srs
                      )}
                    </span>
                  </p>
                </div>
              )}
            </CardDescription>
          </CardContent>
        </Card>
      )}

      {isInitialLoading ? (
        <TableSkeleton />
      ) : (
        <DataTable<ServiceRequests>
          table={table}
          columns={columns}
          isLoading={listIsLoading}
          error={listError}
          totalCount={totalCount}
          searchFieldOptions={SR_SUMMARY_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          facetFilterOptions={facetFilterOptions}
          dateFilterColumns={SR_SUMMARY_DATE_COLUMNS}
          showExportButton={true}
          onExport={"default"}
          exportFileName={`SR_Summary_${projectId || "all"}`}
        />
      )}
    </div>
  );
};

export default ProjectSRSummaryTable;
