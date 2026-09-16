import React, { useCallback, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import memoize from "lodash/memoize";
import { Info } from "lucide-react";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";

// --- UI Components ---
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { TableSkeleton } from "@/components/ui/skeleton";
import { TailSpin } from "react-loader-spinner";

// --- Hooks & Utils ---
import {
  useServerDataTable,
  GroupByConfig,
  SimpleAggregationConfig,
  CustomAggregationConfig,
} from "@/hooks/useServerDataTable";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { CriticalPOCell, criticalPOLabel } from "@/components/helpers/CriticalPOCell";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { cn } from "@/lib/utils";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import {
  useProjectPOAggregates,
  useProjectPOSupportingData,
} from "@/pages/projects/data/tab/summary/useProjectPOSummaryApi";
import { useProjectAllCredits } from "../hooks/useProjectAllCredits";

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
  "amount_paid",
  "amount",
  "vendor",
  "vendor_name",
  "procurement_request",
  "status",
  "billing_status",
  "po_amount_delivered",
  // --- NEW FIELD ---
  "payment_type",
  // -----------------
  "expected_delivery_date",
  "latest_delivery_date",
];

// Searchable fields configuration for PO Summary tables
export const PO_SUMMARY_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "name",
    label: "PO ID",
    placeholder: "Search by PO ID...",
   
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
    value: "items",
    label: "Item in PO",
    placeholder: "Search by Item in PO...",
    is_json: true,
     default: true,
  },
];

// Date columns for the PO Summary table
export const PO_SUMMARY_DATE_COLUMNS: string[] = ["creation", "modified", "expected_delivery_date", "latest_delivery_date"];

// Status options for faceted filter (if needed for this specific summary view)
export const PO_SUMMARY_STATUS_OPTIONS = [
  { label: "PO Approved", value: "PO Approved" },
  { label: "Dispatched", value: "Dispatched" },
  { label: "Partially Delivered", value: "Partially Delivered" },
  { label: "Delivered", value: "Delivered" },
  { label: "Merged", value: "Merged" },
  // Add other relevant statuses
];

// Work Package options (if you derive WP for POs and want to facet filter)
// This would require fetching PR data or having WP directly on PO
// export const PO_SUMMARY_WP_OPTIONS = (wpData: {label:string, value:string}[]) => wpData;

// --- Constants ---
const DOCTYPE = "Procurement Orders";

interface ProjectPOSummaryTableProps {
  projectId: string | undefined;
  hideSummaryCard?: boolean;
  hideFinancialColumns?: boolean;
}

// =================== AGGREGATION CONFIG (MODIFIED) ===================
const POS_AGGREGATES_CONFIG: (
  | SimpleAggregationConfig
  | CustomAggregationConfig
)[] = [
  // --- Simple Aggregates (existing format for direct sums) ---
  { field: "amount", function: "sum" }, // Results in `sum_of_amount`
  { field: "total_amount", function: "sum" }, // Results in `sum_of_total_amount`
  { field: "amount_paid", function: "sum" }, // Results in `sum_of_amount_paid`
  { field: "po_amount_delivered", function: "sum" }, // Results in `sum_of_po_amount_delivered`

  // --- Custom Aggregates (new expressive format) ---
  {
    alias: "payment_against_delivered", // Custom result key
    aggregate: "SUM",
    expression: {
      function: "MIN",
      args: ["amount_paid", "po_amount_delivered"],
    },
  },
  {
    alias: "advance_against_po", // Custom result key
    aggregate: "SUM",
    expression: {
      function: "MAX",
      args: [
        0, // Literal number argument
        {
          function: "SUBTRACT",
          args: ["amount_paid", "po_amount_delivered"],
        },
      ],
    },
  },
];
// =================== END OF MODIFIED CONFIG ===================
// NEW: Configuration for the "Top 5" group by request
const POS_GROUP_BY_CONFIG: GroupByConfig = {
  groupByField: "type",
  aggregateField: "amount",
  aggregateFunction: "sum",
  limit: 5,
};
const AppliedFiltersDisplay = ({ filters, search }) => {
  const hasFilters = filters.length > 0 || !!search;
  if (!hasFilters) {
    return (
      <p className="text-sm text-gray-500">
        Overview of all PO Summary expenses.
      </p>
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

// --- Component ---
export const ProjectPOSummaryTable: React.FC<ProjectPOSummaryTableProps> = ({
  projectId,
  hideSummaryCard = false,
  hideFinancialColumns = false,
}) => {
  const { toast } = useToast();

  if (!projectId) return "Project ID is required.";

  const { poAggregates, poAmountsDict, aggregatesLoading, aggregatesError } =
    useProjectPOAggregates(projectId);

  // --- Supporting Data (for display in columns/facets, not for main list filtering) ---
  const { projectsResponse, projectPaymentsResponse, criticalPOTasksResponse } =
    useProjectPOSupportingData(projectId);
  const { data: criticalPOTasks, isLoading: criticalPOTasksLoading } = criticalPOTasksResponse;
  const { data: projects, isLoading: projectsLoading } = projectsResponse;

  // --- Supporting Data for Columns (Vendor Names, Users) ---
  const {
    data: vendors,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList({ vendorTypes: ["Material", "Material & Service"] });

  const {
    data: userList,
    isLoading: userListLoading,
    error: userListError,
  } = useUsersList();

  const {
    data: projectPayments,
    isLoading: projectPaymentsLoading,
    error: projectPaymentsError,
  } = projectPaymentsResponse;

  const { totals: creditTotals } = useProjectAllCredits(projectId);

  const TotalPurchaseOverCredit = creditTotals.totalPurchase;
  const CreditPaidAmount = creditTotals.paid;

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

  const getProjectName = useCallback(
    memoize(
      (projId?: string) =>
        projects?.find((p) => p.name === projId)?.project_name || projId || "--"
    ),
    [projects]
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

  // --- Critical PO Tasks reverse map ---
  const criticalTasksByPO = useMemo(() => {
    const map = new Map<string, CriticalPOTask[]>();
    if (!criticalPOTasks) return map;
    for (const task of criticalPOTasks) {
      for (const po of task.linked_pos ?? []) {
        const existing = map.get(po) || [];
        existing.push(task);
        map.set(po, existing);
      }
    }
    return map;
  }, [criticalPOTasks]);

  // --- Static Filters for useServerDataTable ---
  const staticFilters = useMemo(() => {
    const filters: Array<[string, string, any]> = [
      ["status", "not in", ["Cancelled", "Merged", "Inactive"]],
    ];
    if (projectId) {
      filters.push(["project", "=", projectId]);
    }
    return filters;
  }, [projectId]);

  // ₹5K threshold (DISABLED — uncomment to re-enable): PO value bucket filter (All / < ₹5,000 / ≥ ₹5,000).
  // type POValueBucket = "all" | "lt5000" | "gte5000";
  // const [poValueBucket, setPoValueBucket] = useState<POValueBucket>("all");

  // Critical PO filtering is a column facet now (Critical PO Task Child Table.task_name), so the list
  // carries only its static scope.
  const dynamicFilters = useMemo(() => {
    const base: Array<[string, string, any]> = [...staticFilters];
    // ₹5K threshold (DISABLED — uncomment to re-enable): compose value bucket onto the base filters.
    // if (poValueBucket === "lt5000") return [...base, ["total_amount", "<", 5000]];
    // if (poValueBucket === "gte5000") return [...base, ["total_amount", ">=", 5000]];
    return base;
  }, [staticFilters /*, poValueBucket — ₹5K threshold (DISABLED) */]);

  // ₹5K threshold (DISABLED — uncomment to re-enable): absolute project counts for the bucket chips (independent of other column filters).
  // const poValueCounts = useMemo(() => {
  //   const counts = { all: 0, lt5000: 0, gte5000: 0 };
  //   if (!poAmountsDict) return counts;
  //   for (const po of Object.values(poAmountsDict)) {
  //     const total = parseNumber((po as any)?.total_incl_gst);
  //     counts.all++;
  //     if (total < 5000) counts.lt5000++;
  //     else counts.gte5000++;
  //   }
  //   return counts;
  // }, [poAmountsDict]);

  // --- Helper function to calculate total liabilities ---
  const calculateTotalLiabilities = useCallback((row: ProcurementOrder): number => {
    const poAmountDelivered = parseNumber(row.po_amount_delivered);
    const amountPaid = parseNumber(row.amount_paid);
    return Math.max(0, poAmountDelivered - Math.min(amountPaid, poAmountDelivered));
  }, []);

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
            <div className="flex flex-col">
              <div className="font-medium flex items-center gap-1 group">
                <Link
                  className="text-blue-600 hover:underline whitespace-nowrap"
                  to={`po/${po.name.replaceAll("/", "&=")}`}
                >
                  {po.name}
                </Link>
                <div className="opacity-90 group-hover:opacity-100 transition-opacity">
                  <ItemsHoverCard
                    parentDoc={po}
                    parentDoctype={DOCTYPE}
                    childTableName="items"
                  />
                </div>
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
          <DataTableColumnHeader column={column} title="Creation Date" className="whitespace-nowrap" />
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
        // Facets on the PO's own critical-task rows; the value is the task's display name.
        id: "Critical PO Task Child Table.task_name",
        accessorFn: (row: ProcurementOrder) => (criticalTasksByPO.get(row.name) || []).map(criticalPOLabel).join(", "),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Critical PO" className="whitespace-nowrap" />
        ),
        cell: ({ row }) => {
          const tasks = criticalTasksByPO.get(row.original.name) || [];
          return <CriticalPOCell tasks={tasks} />;
        },
        size: 180,
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          facet: { field: "task_name", title: "Critical PO" } satisfies FacetDeclaration,
          exportHeaderName: "Critical PO Categories",
          exportValue: (row: ProcurementOrder) => {
            const tasks = criticalTasksByPO.get(row.name) || [];
            return tasks.map(criticalPOLabel).join(", ") || "";
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
          facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
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
          facet: { field: "status", title: "Status" } satisfies FacetDeclaration,
          exportValue: (row: ProcurementOrder) => {
            return row.status;
          },
        },
      },
      {
        accessorKey: "billing_status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Billing" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={row.original.billing_status === "Non-Billable" ? "red" : "green"}
          >
            {row.original.billing_status === "Non-Billable" ? "Non-Billable" : "Billable"}
          </Badge>
        ),
        enableColumnFilter: true,
        size: 130,
        meta: {
          facet: { field: "billing_status", title: "Billing" } satisfies FacetDeclaration,
          exportHeaderName: "Billing",
          exportValue: (row: ProcurementOrder) =>
            row.billing_status === "Non-Billable" ? "Non-Billable" : "Billable",
        },
      },
      {
        accessorKey: "expected_delivery_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Expected Delivery" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {row.original.expected_delivery_date ? formatDate(row.original.expected_delivery_date) : "--"}
          </div>
        ),
        size: 180,
        meta: {
          exportHeaderName: "Expected Delivery Date",
          exportValue: (row: ProcurementOrder) =>
            row.expected_delivery_date ? formatDate(row.expected_delivery_date) : "--",
        },
      },
      {
        accessorKey: "latest_delivery_date",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Latest Delivery" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {row.original.latest_delivery_date ? formatDate(row.original.latest_delivery_date) : "--"}
          </div>
        ),
        size: 150,
        meta: {
          exportHeaderName: "Latest Delivery Date",
          exportValue: (row: ProcurementOrder) =>
            row.latest_delivery_date ? formatDate(row.latest_delivery_date) : "--",
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
        enableColumnFilter: true,
        size: 180,
        meta: {
          facet: { field: "owner", title: "Approved By" } satisfies FacetDeclaration,
          exportHeaderName: "Approved By",
          exportValue: (row: ProcurementOrder) => {
            const ownerUser = userList?.find(
              (entry) => row.owner === entry.name
            );
            return ownerUser?.full_name || row.owner || "--";
          },
        },
      },
      // Financial columns - conditionally included based on hideFinancialColumns prop
      ...(!hideFinancialColumns
        ? [
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
              meta: {
                exportHeaderName: "PO Value (inc. GST)",
                exportValue: (row: ProcurementOrder) => {
                  return formatForReport(row.total_amount);
                },
              },
            } as ColumnDef<ProcurementOrder>,
            {
              accessorKey: "amount_paid",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Amount Paid" />
              ),
              cell: ({ row }) => (
                <div className="font-medium pr-2 text-center tabular-nums">
                  {formatToRoundedIndianRupee(row.original.amount_paid)}
                </div>
              ),
              size: 160,
              meta: {
                exportHeaderName: "Amount Paid",
                exportValue: (row: ProcurementOrder) => {
                  return formatForReport(row.amount_paid);
                },
              },
            } as ColumnDef<ProcurementOrder>,
            {
              accessorKey: "po_amount_delivered",
              header: ({ column }) => (
                <DataTableColumnHeader
                  column={column}
                  title={
                    <>
                      Payable Amt against
                      <br />
                      Delivered Items
                    </>
                  }
                />
              ),
              cell: ({ row }) => (
                <div className="font-medium pr-2 text-center tabular-nums">
                  {formatToRoundedIndianRupee(row.original.po_amount_delivered)}
                </div>
              ),
              size: 160,
              meta: {
                exportHeaderName: "PO Amount Payable",
                exportValue: (row: ProcurementOrder) => {
                  return formatForReport(row.po_amount_delivered);
                },
              },
            } as ColumnDef<ProcurementOrder>,
            {
              id: "total_liabilities",
              accessorFn: (row) => calculateTotalLiabilities(row),
              header: "Total Liabilities",
              cell: ({ row }) => {
                const liability = calculateTotalLiabilities(row.original);
                return (
                  <div className="font-medium pr-2 text-center tabular-nums">
                    {formatToRoundedIndianRupee(liability)}
                  </div>
                );
              },
              size: 160,
              enableSorting: false,
              meta: {
                exportHeaderName: "Total Liabilities",
                exportValue: (row: ProcurementOrder) => {
                  return formatForReport(calculateTotalLiabilities(row));
                },
              },
            } as ColumnDef<ProcurementOrder>,
            {
              accessorKey: "payment_type",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Payment Type" />
              ),
              cell: ({ row }) => {
                const type = row.original.payment_type;
                let variant: "default" | "green" | "yellow" = "default";
                if (type === "Credit") variant = "yellow";
                if (type === "Delivery against Payment") variant = "green";

                return (
                  <div className="font-medium pr-2 text-center tabular-nums">
                    <Badge
                      variant={variant}
                      className="whitespace-nowrap text-center"
                    >
                      {type === "Delivery against Payment" ? "DAP" : type || "N/A"}
                    </Badge>
                  </div>
                );
              },
              enableColumnFilter: true,
              size: 150,
              meta: {
                facet: { field: "payment_type", title: "Payment Type" } satisfies FacetDeclaration,
                exportHeaderName: "Payment Type",
                exportValue: (row: ProcurementOrder) => row.payment_type || "N/A",
              },
            } as ColumnDef<ProcurementOrder>,
          ]
        : []),
    ],
    [
      getVendorName,
      criticalTasksByPO,
      getTotalAmountPaidForPO,
      userList,
      poAmountsDict,
      calculateTotalLiabilities,
      hideFinancialColumns,
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
    exportAllRows,
    isExporting,
    aggregates, // NEW
    isAggregatesLoading, // NEW
    groupByResult, // NEW
    columnFilters, // NEW: To display applied filters
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    // setPagination, // ₹5K threshold (DISABLED — uncomment to re-enable): needed to reset page on bucket chip click.
  } = useServerDataTable<ProcurementOrder>({
    doctype: DOCTYPE,
    columns: columns, // Columns are defined below
    fetchFields: PO_SUMMARY_LIST_FIELDS_TO_FETCH as string[],
    searchableFields: PO_SUMMARY_SEARCHABLE_FIELDS,
    urlSyncKey: urlSyncKey,
    defaultSort: "modified desc",
    enableRowSelection: false, // No selection needed for summary
    additionalFilters: dynamicFilters,
    aggregatesConfig: POS_AGGREGATES_CONFIG, // NEW: Pass the config
    groupByConfig: POS_GROUP_BY_CONFIG, // NEW: Pass the group by config
  });

  const isLoadingOverall =
    vendorsLoading ||
    userListLoading ||
    aggregatesLoading ||
    projectPaymentsLoading ||
    criticalPOTasksLoading;
  const combinedErrorOverall =
    vendorsError ||
    userListError ||
    listError ||
    aggregatesError ||
    projectPaymentsError;

  if (combinedErrorOverall && !poDataForPage?.length && !poAggregates) {
    toast({
      title: "Error Loading PO Summary",
      description: combinedErrorOverall.message,
      variant: "destructive",
    });
  }
  // console.log("Aggreate", aggregates)
  return (
    <div className="space-y-4">
      {/* <Card>
                <CardContent className="flex flex-row items-center justify-between p-4">
                    <CardDescription>
                        <p className="text-lg font-semibold text-gray-700">
                            PO Summary
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
                                <p>
                                    <span className="font-medium">Total Liabilities:</span>{" "}
                                    <span className="text-yellow-600 font-semibold">
                                        {formatToRoundedIndianRupee(
                                            relatedTotalBalanceCredit
                                        )}
                                    </span>
                                </p>
                                <p>
                                    <span className="font-medium">Total Due Not Paid:</span>{" "}
                                    <span className="text-red-600 font-semibold">
                                        {formatToRoundedIndianRupee(
                                            relatedTotalDue
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
            </Card> */}

      {/* ₹5K threshold (DISABLED — uncomment the block below to re-enable): PO value bucket chips (All / Below ₹5K / ₹5K & Above) */}
      {/*
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { value: "all", label: "All POs", count: poValueCounts.all },
          { value: "lt5000", label: "Below ₹5K", count: poValueCounts.lt5000 },
          { value: "gte5000", label: "₹5K & Above", count: poValueCounts.gte5000 },
        ] as { value: POValueBucket; label: string; count: number }[]).map((b) => {
          const isActive = poValueBucket === b.value;
          return (
            <button
              key={b.value}
              type="button"
              onClick={() => {
                setPoValueBucket(b.value);
                // ₹5K threshold: reset to page 1 — additionalFilters change doesn't auto-reset pagination.
                setPagination(p => ({ ...p, pageIndex: 0 }));
              }}
              className={cn(
                "px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors flex items-center gap-1.5 whitespace-nowrap",
                isActive
                  ? "bg-sky-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              {b.label}
              <span className={cn("text-xs font-bold", isActive ? "opacity-90" : "opacity-70")}>
                {b.count}
              </span>
            </button>
          );
        })}
      </div>
      */}

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
          facetDoctype={DOCTYPE}
          facetOverrides={{
            status: { additionalFilters: dynamicFilters },
            vendor: { additionalFilters: dynamicFilters },
            owner: { additionalFilters: dynamicFilters },
            payment_type: { additionalFilters: dynamicFilters },
            billing_status: { additionalFilters: dynamicFilters },
            "Critical PO Task Child Table.task_name": { additionalFilters: dynamicFilters },
          }}
          dateFilterColumns={PO_SUMMARY_DATE_COLUMNS}
          showExportButton={true}
          onExport={"default"}
          onExportAll={exportAllRows}
          isExporting={isExporting}
          exportFileName={`Project_PO_Summary_${getProjectName(projectId) || "all"}`}
          showRowSelection={false}
          summaryCard={hideSummaryCard ? undefined :
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-lg">PO Summary</CardTitle>
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
                  <div className="grid grid-cols-1  gap-x-8 gap-y-4">
                    {/* Column 2: PO Totals (inc. GST/exc. GST/Paid) - Updated */}
                    <div className="grid grid-cols-2 gap-y-2 gap-x-20 text-sm">
                      {" "}
                      {/* Changed to items-start for consistent alignment */}
                      <p className="flex justify-between w-full">
                        <span className="font-medium inline-flex items-center gap-1 group">
                          Total PO Amount (Inc. GST)
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">
                              Total project POs Amount including GST.
                            </HoverCardContent>
                          </HoverCard>
                        </span>{" "}
                        <span className="text-blue-600 font-semibold">
                          {formatToRoundedIndianRupee(
                            aggregates.sum_of_total_amount
                          )}
                        </span>
                      </p>
                      <p className="flex justify-between w-full">
                        <span className="font-medium inline-flex items-center gap-1 group">
                          Payable Amount Against Delivered Items in PO
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">
                              Total amount for delivered POs that are now
                              payable.
                            </HoverCardContent>
                          </HoverCard>
                        </span>{" "}
                        <span className="text-yellow-600 font-semibold">
                          {formatToRoundedIndianRupee(
                            aggregates.sum_of_po_amount_delivered
                          )}
                        </span>
                      </p>
                      <p className="flex justify-between w-full">
                        <span className="font-medium inline-flex items-center gap-1 group">
                          Total PO Amount (exc. GST)
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">
                              Total project POs Amount excluding GST.
                            </HoverCardContent>
                          </HoverCard>
                        </span>{" "}
                        <span className="text-blue-600 font-semibold">
                          {formatToRoundedIndianRupee(aggregates.sum_of_amount)}
                        </span>
                      </p>
                      <p className="flex justify-between w-full">
                        <span className="font-medium inline-flex items-center gap-1 group">
                          Amount Paid Against Delivered Items in PO
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">
                              Amount paid against delivered items in this
                              project’s POs.
                            </HoverCardContent>
                          </HoverCard>
                        </span>{" "}
                        <span className="text-green-600 font-semibold">
                          {formatToRoundedIndianRupee(
                            aggregates.payment_against_delivered
                          )}
                        </span>
                      </p>
                      <p className="flex justify-between w-full">
                        <span className="font-medium inline-flex items-center gap-1 group">
                          Total Amt Paid
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">
                              Total expenses recorded for this project POs.
                            </HoverCardContent>
                          </HoverCard>
                        </span>{" "}
                        <span className="text-green-600 font-semibold">
                          {formatToRoundedIndianRupee(
                            aggregates.sum_of_amount_paid
                          )}
                        </span>
                      </p>
                      <p className="flex justify-between w-full">
                        <span className="font-medium inline-flex items-center gap-1 group">
                          Advance Against PO
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">
                              Advance amount paid before delivery for this
                              project’s POs.
                            </HoverCardContent>
                          </HoverCard>
                        </span>{" "}
                        <span className="text-red-600 font-semibold">
                          {formatToRoundedIndianRupee(
                            aggregates.advance_against_po
                          )}
                        </span>
                      </p>
                    </div>

                    {/* Column 1: Overall Totals (Liabilities/Due) - Already Updated */}
                    <Card>
                      <CardHeader className="p-2">
                        {/* <CardTitle className="text-lg">Project Credit</CardTitle> */}
                        <CardDescription>
                          {" "}
                          Overall PO Credit Summary.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-2 pt-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-20 text-sm">
                          <p className="flex justify-between w-full">
                            <span className="font-medium inline-flex items-center gap-1 group">
                              Total Purchase Over Credit
                              <HoverCard>
                                <HoverCardTrigger asChild>
                                  <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                </HoverCardTrigger>
                                <HoverCardContent className="text-xs w-auto p-1.5">
                                  Total value of credit POs Purchase for this
                                  Project.
                                </HoverCardContent>
                              </HoverCard>
                            </span>{" "}
                            <span className="text-blue-600 font-semibold">
                              {formatToRoundedIndianRupee(
                                TotalPurchaseOverCredit
                              )}
                            </span>
                          </p>

                          {/* Total Due Not Paid */}
                          <p className="flex justify-between w-full">
                            <span className="font-medium inline-flex items-center gap-1 group">
                              {" "}
                              Amount Paid
                              <HoverCard>
                                <HoverCardTrigger asChild>
                                  <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                </HoverCardTrigger>
                                <HoverCardContent className="text-xs w-auto p-1.5">
                                  Total value of credit POs that are paid.
                                </HoverCardContent>
                              </HoverCard>
                            </span>{" "}
                            <span className="text-green-600 font-semibold">
                              {formatToRoundedIndianRupee(CreditPaidAmount)}
                            </span>
                          </p>
                        </div>
                      </CardContent>
                    </Card>
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
      )}
    </div>
  );
};

export default ProjectPOSummaryTable;
