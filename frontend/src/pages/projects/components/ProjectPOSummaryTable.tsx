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
import { TailSpin } from "react-loader-spinner";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments"; // For paid amounts
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests"; // For WP lookup

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { omit } from "lodash";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";

// Fields to fetch for the PO Summary table list view
export const PO_SUMMARY_LIST_FIELDS_TO_FETCH: (
  | keyof ProcurementOrder
  | "name"
)[] = [
  "name",
  "creation",
  "modified",
  "owner",
  "project",
  "project_name",
  "total_amount",
  "amount",
  "vendor",
  "vendor_name",
  "procurement_request",
  "status",
  "loading_charges",
  "freight_charges",
  "custom", // Add custom if used for badge
  // Add invoice_data if needed for a column in this specific summary table
];

// Searchable fields configuration for PO Summary tables
export const PO_SUMMARY_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "name",
    label: "PO ID",
    placeholder: "Search by PO ID...",
    default: true,
  },
  {
    value: "vendor_name",
    label: "Vendor Name",
    placeholder: "Search by Vendor Name...",
  },
  {
    value: "vendor",
    label: "Vendor ID",
    placeholder: "Search by Vendor ID...",
  },
  { value: "status", label: "Status", placeholder: "Search by Status..." },
  {
    value: "procurement_request",
    label: "PR ID",
    placeholder: "Search by PR ID",
  },
  {
    value: "order_list",
    label: "Item in PO",
    placeholder: "Search by Item in PO...",
    is_json: true,
  },
];

// Date columns for the PO Summary table
export const PO_SUMMARY_DATE_COLUMNS: string[] = ["creation", "modified"];

// Status options for faceted filter (if needed for this specific summary view)
export const PO_SUMMARY_STATUS_OPTIONS = [
  { label: "PO Approved", value: "PO Approved" },
  { label: "Dispatched", value: "Dispatched" },
  { label: "Partially Delivered", value: "Partially Delivered" },
  { label: "Delivered", value: "Delivered" },
  { label: "Merged", value: "Merged" },
  { label: "PO Amendment", value: "PO Amendment" },
  // Add other relevant statuses
];

// Work Package options (if you derive WP for POs and want to facet filter)
// This would require fetching PR data or having WP directly on PO
// export const PO_SUMMARY_WP_OPTIONS = (wpData: {label:string, value:string}[]) => wpData;

// --- Constants ---
const DOCTYPE = "Procurement Orders";

interface ProjectPOSummaryTableProps {
  projectId: string | undefined;
}

interface POAmountsDict {
  [key: string]: {
    total_incl_gst: number;
    total_excl_gst: number;
  };
}

interface POAggregates {
  total_po_value_inc_gst: number;
  total_po_value_excl_gst: number;
  total_amount_paid_for_pos: number;
  total_gst_on_items: number;
  final_total_gst: number;
}

interface POAggregatesResponse extends POAggregates {
  po_amounts_dict: POAmountsDict;
}

// --- Component ---
export const ProjectPOSummaryTable: React.FC<ProjectPOSummaryTableProps> = ({
  projectId,
}) => {
  const { toast } = useToast();

  if (!projectId) return "Project ID is required.";

  // --- State for Aggregates Card ---
  const [poAggregates, setPOAggregates] = useState<POAggregates | null>(null);
  const [poAmountsDict, setPOAmountsDict] = useState<POAmountsDict | null>(
    null
  );

  // --- API Call for Aggregated PO Totals ---
  const {
    call: fetchPOAggregates,
    loading: aggregatesLoading,
    error: aggregatesError,
  } = useFrappePostCall<{ message: POAggregatesResponse }>(
    "nirmaan_stack.api.projects.project_aggregates.get_project_po_summary_aggregates"
  );

  useEffect(() => {
    // console.log("HEys");
    if (projectId) {
      fetchPOAggregates({ project_id: projectId })
        .then((data) => {
          setPOAggregates(omit(data.message, ["po_amounts_dict"]));
          setPOAmountsDict(data.message.po_amounts_dict);
        })
        .catch((err) => console.error("Failed to fetch PO aggregates:", err));
    } else {
      setPOAggregates(null); // Reset if no projectId
      setPOAmountsDict(null);
    }
  }, [projectId, fetchPOAggregates]);

  // --- Supporting Data for Columns (Vendor Names, PR for WP, Users) ---
  const {
    data: vendors,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList({ vendorTypes: ["Material", "Material & Service"] });

  const {
    data: pr_data,
    isLoading: prDataLoading,
    error: prDataError,
  } = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["name", "work_package"],
      filters: projectId ? [["project", "=", projectId]] : [],
      limit: 0,
    },
    !!projectId ? `PRsForPOSummary_${projectId || "all"}` : null
  );

  const {
    data: userList,
    isLoading: userListLoading,
    error: userListError,
  } = useUsersList();

  const {
    data: projectPayments,
    isLoading: projectPaymentsLoading,
    error: projectPaymentsError,
  } = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["document_name", "amount", "status"],
      filters: [
        ["document_type", "=", "Procurement Orders"],
        ["status", "=", "Paid"],
        ["project", "=", projectId],
      ],
      limit: 0,
    },
    !!projectId ? `PaidPaymentsForPOSummary_${projectId || "all"}` : null
  );

  const vendorOptions = useMemo(
    () =>
      vendors?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) ||
      [],
    [vendors]
  );

  // --- Memoized Lookups ---
  const getVendorName = useCallback(
    memoize(
      (vendorId?: string) =>
        vendors?.find((v) => v.name === vendorId)?.vendor_name ||
        vendorId ||
        "--"
    ),
    [vendors]
  );

  const getWorkPackageName = useMemo(
    () =>
      memoize((po: ProcurementOrder): string => {
        if (po.custom === "true") return "Custom"; // If PO itself is custom
        const relatedPR = pr_data?.find(
          (pr) => pr.name === po.procurement_request
        );
        return relatedPR?.work_package || "N/A";
      }),
    [pr_data]
  );

  const getTotalAmountPaidForPO = useMemo(() => {
    if (!projectPayments) return () => 0;
    const paymentsMap = new Map<string, number>();
    projectPayments.forEach((p) => {
      // Assuming projectPayments is already filtered for "Paid" PO payments
      if (p.document_name) {
        paymentsMap.set(
          p.document_name,
          (paymentsMap.get(p.document_name) || 0) + parseNumber(p.amount)
        );
      }
    });
    return memoize((poName: string) => paymentsMap.get(poName) || 0);
  }, [projectPayments]);

  // --- Static Filters for useServerDataTable ---
  const staticFilters = useMemo(() => {
    const filters: Array<[string, string, any]> = [
      ["status", "not in", ["Cancelled", "Merged"]],
    ];
    if (projectId) {
      filters.push(["project", "=", projectId]);
    }
    return filters;
  }, [projectId]);

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ProcurementOrder>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO ID" />
        ),
        cell: ({ row }) => {
          const po = row.original;
          return (
            <div className="font-medium flex items-center gap-1 group">
              <Link
                className="text-blue-600 hover:underline whitespace-nowrap"
                to={`po/${po.name.replaceAll("/", "&=")}`}
              >
                {po.name}
              </Link>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ItemsHoverCard
                  parentDocId={po}
                  parentDoctype={DOCTYPE}
                  childTableName="items"
                />
              </div>
              {po.custom === "true" && (
                <Badge variant="outline" className="text-xs">
                  Custom
                </Badge>
              )}
            </div>
          );
        },
        size: 200,
        meta: {
          exportHeaderName: "PO ID",
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO Creation Date" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 150,
        meta: {
          exportHeaderName: "PO Creation Date",
        },
      },
      {
        id: "work_package",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Package" />
        ),
        cell: ({ row }) => (
          <div className="font-medium truncate">
            {getWorkPackageName(row.original)}
          </div>
        ),
        size: 150, // Add filterFn if client-side filtering on this derived value is needed
        meta: {
          exportHeaderName: "Package",
          exportValue: (row: ProcurementOrder) => {
            return getWorkPackageName(row);
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
        size: 180,
        meta: {
          exportHeaderName: "Vendor",
          exportValue: (row: ProcurementOrder) => {
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
            variant={
              row.original.status === "PO Approved" ? "green" : "secondary"
            }
          >
            {row.original.status}
          </Badge>
        ),
        enableColumnFilter: true,
        size: 150,
        meta: {
          exportValue: (row: ProcurementOrder) => {
            return row.status;
          },
        },
      },
      {
        accessorKey: "owner",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Approved By" />
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
          exportHeaderName: "Approved By",
          exportValue: (row: ProcurementOrder) => {
            const ownerUser = userList?.find(
              (entry) => row.owner === entry.name
            );
            return ownerUser?.full_name || row.owner || "--";
          },
        },
      },
      // {
      //     id: "po_value_inc_gst", header: ({ column }) => <DataTableColumnHeader column={column} title="PO Value (inc. GST)" />,
      //     // cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(poAmountsDict?.[row.original.name]?.total_incl_gst)}</div>,
      //          cell: ({ row }) => <div className="font-medium truncate">{formatToRoundedIndianRupee(row.original.total_amount)}</div>,
      //     size: 160, enableSorting: true,
      //     meta: {
      //         exportHeaderName: "PO Value (inc. GST)",
      //         exportValue: (row: ProcurementOrder) => {
      //             return formatForReport(row.total_amount);
      //         }
      //     }
      // },
      {
        // Use 'accessorKey' to make it sortable by the data table library
        accessorKey: "total_amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO Value (inc. GST)" />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2 text-center tabular-nums">
            {formatToRoundedIndianRupee(row.original.total_amount)}
          </div>
        ),
        size: 160,
        // enableSorting is true by default when using accessorKey
        meta: {
          exportHeaderName: "PO Value (inc. GST)",
          exportValue: (row: ProcurementOrder) => {
            return formatForReport(row.total_amount); // Use the direct field for export
          },
        },
      },

      {
        id: "amount_paid_po",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amt. Paid" />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2 text-center">
            {formatToRoundedIndianRupee(
              getTotalAmountPaidForPO(row.original.name)
            )}
          </div>
        ),
        size: 130,
        enableSorting: false,
        meta: {
          exportHeaderName: "Amt. Paid",
          exportValue: (row: ProcurementOrder) => {
            return formatForReport(getTotalAmountPaidForPO(row.name));
          },
        },
      },
    ],
    [
      getVendorName,
      getWorkPackageName,
      getTotalAmountPaidForPO,
      userList,
      poAmountsDict,
    ]
  );

  // --- useServerDataTable Hook for the paginated PO list ---
  const urlSyncKey = useMemo(
    () => `prj_po_summary_${projectId || "all"}`,
    [projectId]
  );

  const {
    table,
    data: poDataForPage,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<ProcurementOrder>({
    doctype: DOCTYPE,
    columns: columns, // Columns are defined below
    fetchFields: PO_SUMMARY_LIST_FIELDS_TO_FETCH as string[],
    searchableFields: PO_SUMMARY_SEARCHABLE_FIELDS,
    urlSyncKey: urlSyncKey,
    defaultSort: "modified desc",
    enableRowSelection: false, // No selection needed for summary
    additionalFilters: staticFilters,
  });

  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(
    () => ({
      vendor: { title: "Vendor", options: vendorOptions },
      status: { title: "Status", options: PO_SUMMARY_STATUS_OPTIONS },
      // Add work_package facet if you create options for it
    }),
    [vendorOptions]
  );

  const isLoadingOverall =
    prDataLoading ||
    vendorsLoading ||
    userListLoading ||
    aggregatesLoading ||
    projectPaymentsLoading;
  const combinedErrorOverall =
    vendorsError ||
    userListError ||
    listError ||
    aggregatesError ||
    projectPaymentsError ||
    prDataError;

  if (combinedErrorOverall && !poDataForPage?.length && !poAggregates) {
    toast({
      title: "Error Loading PO Summary",
      description: combinedErrorOverall.message,
      variant: "destructive",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-row items-center justify-between p-4">
          <CardDescription>
            <p className="text-lg font-semibold text-gray-700">
              PO Summary
              {/* ({getProjectName(projectId) || "All Projects"}) */}
            </p>
            <p className="text-sm text-gray-500">
              Overview of Purchase Order totals
            </p>
          </CardDescription>
          <CardDescription className="text-right">
            {aggregatesLoading && !poAggregates ? (
              <TailSpin height={20} width={20} />
            ) : aggregatesError ? (
              <span className="text-xs text-destructive">
                Error loading totals
              </span>
            ) : poAggregates ? (
              <div className="flex flex-col items-end text-sm">
                <p>
                  <span className="font-medium">Total (inc. GST):</span>{" "}
                  <span className="text-blue-600 font-semibold">
                    {formatToRoundedIndianRupee(
                      poAggregates.total_po_value_inc_gst
                    )}
                  </span>
                </p>
                <p>
                  <span className="font-medium">Total (exc. GST):</span>{" "}
                  <span className="text-blue-600 font-semibold">
                    {formatToRoundedIndianRupee(
                      poAggregates.total_po_value_excl_gst
                    )}
                  </span>
                </p>
                <p>
                  <span className="font-medium">Total Amt Paid:</span>{" "}
                  <span className="text-green-600 font-semibold">
                    {formatToRoundedIndianRupee(
                      poAggregates.total_amount_paid_for_pos
                    )}
                  </span>
                </p>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                No summary data.
              </span>
            )}
          </CardDescription>
        </CardContent>
      </Card>

      {isLoadingOverall && !poDataForPage?.length ? (
        <TableSkeleton />
      ) : (
        <DataTable<ProcurementOrder>
          table={table}
          columns={columns}
          isLoading={listIsLoading}
          error={listError}
          totalCount={totalCount}
          searchFieldOptions={PO_SUMMARY_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          facetFilterOptions={facetFilterOptions}
          dateFilterColumns={PO_SUMMARY_DATE_COLUMNS}
          showExportButton={true}
          onExport={"default"}
          exportFileName={`Project_PO_Summary_${projectId || "all"}`}
          showRowSelection={false} // No selection needed for this summary
        />
      )}
    </div>
  );
};

export default ProjectPOSummaryTable;
