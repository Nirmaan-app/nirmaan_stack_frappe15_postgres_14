import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import memoize from "lodash/memoize";
import { Info } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

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
import { useServerDataTable, AggregationConfig, GroupByConfig } from "@/hooks/useServerDataTable";
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
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { omit } from "lodash";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { useCredits } from "@/pages/credits/hooks/useCredits";

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
        "po_amount_delivered",
        "custom", // Add custom if used for badge
        // Add invoice_data if needed for a column in this specific summary table
    ];

// Searchable fields configuration for PO Summary tables
export const PO_SUMMARY_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PO ID", placeholder: "Search by PO ID...", default: true },
    { value: "vendor_name", label: "Vendor Name", placeholder: "Search by Vendor Name..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    { value: "status", label: "Status", placeholder: "Search by Status..." },
    { value: "procurement_request", label: "PR ID", placeholder: "Search by PR ID" },
    {
        value: "items",
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


//Aggregations
const POS_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' },
    {
        field: 'total_amount', function: 'sum'
    },
    { field: 'amount_paid', function: 'sum' },
    { field: 'po_amount_delivered', function: 'sum' },

];
// NEW: Configuration for the "Top 5" group by request
const POS_GROUP_BY_CONFIG: GroupByConfig = {
    groupByField: 'type',
    aggregateField: 'amount',
    aggregateFunction: 'sum',
    limit: 5,
};
const AppliedFiltersDisplay = ({ filters, search }) => {
    const hasFilters = filters.length > 0 || !!search;
    if (!hasFilters) {
        return <p className="text-sm text-gray-500">Overview of all PO Summary expenses.</p>;
    }
    return (
        <div className="text-sm text-gray-500 flex flex-wrap gap-2 items-center mt-2">
            <span className="font-medium">Filtered by:</span>
            {search && <span className="px-2 py-1 bg-gray-200 rounded-md text-xs">{`Search: "${search}"`}</span>}
            {filters.map(filter => (
                <span key={filter.id} className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs capitalize whitespace-nowrap">
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

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

    const { data: CreditData } = useCredits()

    const creditsByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId && cr.term_status !== "Paid"));
    const dueByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId && cr.term_status !== "Paid" && cr.status !== "Created"));

    const relatedTotalBalanceCredit = creditsByProject(projectId).reduce((sum, term) => sum + parseNumber(term.amount), 0);
    const relatedTotalDue = dueByProject(projectId).reduce((sum, term) => sum + parseNumber(term.amount), 0);

    const vendorOptions = useMemo(
        () =>
            vendors?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) ||
            [],
        [vendors]
    );

    // Create user options for the "Approved By" filter
    const userOptions = useMemo(() => userList?.map(u => ({ label: u.full_name, value: (u.full_name === "Administrator" ? "Administrator" : u.name) })) || [], [userList]);

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
            ["status", "not in", ["Cancelled", "Merged","Inactive"]],
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
                enableColumnFilter: true,
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
                // Use 'accessorKey' to make it sortable by the data table library
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
                // enableSorting is true by default when using accessorKey
                meta: {
                    exportHeaderName: "Amount Paid",
                    exportValue: (row: ProcurementOrder) => {
                        return formatForReport(row.amount_paid); // Use the direct field for export
                    },
                },
            },
            {
                // Use 'accessorKey' to make it sortable by the data table library
                accessorKey: "po_amount_delivered",
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="Payable Amount" />
                ),
                cell: ({ row }) => (
                    <div className="font-medium pr-2 text-center tabular-nums">
                        {formatToRoundedIndianRupee(row.original.po_amount_delivered)}
                    </div>
                ),
                size: 160,
                // enableSorting is true by default when using accessorKey
                meta: {
                    exportHeaderName: "Amount Paid",
                    exportValue: (row: ProcurementOrder) => {
                        return formatForReport(row.po_amount_delivered); // Use the direct field for export
                    },
                },
            },
            // {
            //     id: "amount_paid_po",
            //     header: ({ column }) => (
            //         <DataTableColumnHeader column={column} title="Amt. Paid" />
            //     ),
            //     cell: ({ row }) => (
            //         <div className="font-medium pr-2 text-center">
            //             {formatToRoundedIndianRupee(
            //                 getTotalAmountPaidForPO(row.original.name)
            //             )}
            //         </div>
            //     ),
            //     size: 130,
            //     enableSorting: false,
            //     meta: {
            //         exportHeaderName: "Amt. Paid",
            //         exportValue: (row: ProcurementOrder) => {
            //             return formatForReport(getTotalAmountPaidForPO(row.name));
            //         },
            //     },
            // },
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
        aggregates, // NEW
        isAggregatesLoading, // NEW
        groupByResult,// NEW
        columnFilters, // NEW: To display applied filters
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
        aggregatesConfig: POS_AGGREGATES_CONFIG, // NEW: Pass the config
        groupByConfig: POS_GROUP_BY_CONFIG, // NEW: Pass the group by config
    });

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(
        () => ({
            vendor: { title: "Vendor", options: vendorOptions },
            status: { title: "Status", options: PO_SUMMARY_STATUS_OPTIONS },
            owner: { title: "Approved By", options: userOptions }, // NEW server-side filter
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
    console.log("Aggreate", aggregates)
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
                    summaryCard={
                        <Card>
                            <CardHeader className="p-4">
                                <CardTitle className="text-lg">PO Summary</CardTitle>
                                <CardDescription>
                                    <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
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
                                        <div className="grid grid-cols-2 gap-y-2 gap-x-20 text-sm"> {/* Changed to items-start for consistent alignment */}
                                            <p className="flex justify-between w-full">
                                                <span className="font-medium inline-flex items-center gap-1 group">Total (inc. GST)
                                                    <HoverCard>
                                                        <HoverCardTrigger asChild>
                                                            <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                        </HoverCardTrigger>
                                                        <HoverCardContent className="text-xs w-auto p-1.5">
                                                            Total project value including GST.
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
                                                <span className="font-medium inline-flex items-center gap-1 group">PO Payable Amount<HoverCard>
                                                    <HoverCardTrigger asChild>
                                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                    </HoverCardTrigger>
                                                    <HoverCardContent className="text-xs w-auto p-1.5">
                                                        Total amount for delivered POs that are now payable.
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
                                                <span className="font-medium inline-flex items-center gap-1 group">Total (exc. GST)<HoverCard>
                                                    <HoverCardTrigger asChild>
                                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                    </HoverCardTrigger>
                                                    <HoverCardContent className="text-xs w-auto p-1.5">
                                                        Total project value excluding GST.
                                                    </HoverCardContent>
                                                </HoverCard>
                                                </span>{" "}
                                                <span className="text-blue-600 font-semibold">
                                                    {formatToRoundedIndianRupee(
                                                        aggregates.sum_of_amount
                                                    )}
                                                </span>
                                            </p>
                                            <p className="flex justify-between w-full">
                                                <span className="font-medium inline-flex items-center gap-1 group">PO Payment Against Delivered<HoverCard>
                                                    <HoverCardTrigger asChild>
                                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                    </HoverCardTrigger>
                                                    <HoverCardContent className="text-xs w-auto p-1.5">
                                                        Amount paid against delivered items in this project’s POs.

                                                    </HoverCardContent>
                                                </HoverCard>
                                                </span>{" "}
                                                <span className="text-green-600 font-semibold">
                                                    {formatToRoundedIndianRupee(
                                                        Math.min(aggregates.sum_of_amount_paid, aggregates.sum_of_po_amount_delivered)
                                                    )}
                                                </span>
                                            </p>
                                            <p className="flex justify-between w-full">
                                                <span className="font-medium inline-flex items-center gap-1 group">Total Amt Paid<HoverCard>
                                                    <HoverCardTrigger asChild>
                                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                    </HoverCardTrigger>
                                                    <HoverCardContent className="text-xs w-auto p-1.5">
                                                       Total expenses recorded for the project.
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
                                                <span className="font-medium inline-flex items-center gap-1 group">Advance Against PO<HoverCard>
                                                    <HoverCardTrigger asChild>
                                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                    </HoverCardTrigger>
                                                    <HoverCardContent className="text-xs w-auto p-1.5">
                                                        Advance amount paid before delivery for this project’s POs.
                                                    </HoverCardContent>
                                                </HoverCard>
                                                </span>{" "}
                                                <span className="text-red-600 font-semibold">
                                                    {formatToRoundedIndianRupee(
                                                        Math.max(0, aggregates.sum_of_amount_paid - aggregates.sum_of_po_amount_delivered)
                                                    )}
                                                </span>
                                            </p>
                                        </div>

                                        {/* Column 1: Overall Totals (Liabilities/Due) - Already Updated */}
                                        <Card>
                                            <CardHeader className="p-2">
                                                {/* <CardTitle className="text-lg">Project Credit</CardTitle> */}
                                                <CardDescription> Overall PO Credit Summary.</CardDescription>
                                            </CardHeader>
                                            <CardContent className="p-2 pt-0">
                                                <div className="flex gap-y-2 gap-x-20 justify-between items-start text-sm">

                                                    <p className="flex justify-between w-full">
                                                        <span className="font-medium inline-flex items-center gap-1 group">Total Liabilities<HoverCard>
                                                            <HoverCardTrigger asChild>
                                                                <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                            </HoverCardTrigger>
                                                            <HoverCardContent className="text-xs w-auto p-1.5">
                                                               Total value of credit POs scheduled for future payment.
                                                            </HoverCardContent>
                                                        </HoverCard>
                                                        </span>{" "}
                                                        <span className="text-yellow-600 font-semibold">
                                                            {formatToRoundedIndianRupee(
                                                                relatedTotalBalanceCredit
                                                            )}
                                                        </span>
                                                    </p>

                                                    {/* Total Due Not Paid */}
                                                    <p className="flex justify-between w-full">
                                                        <span className="font-medium inline-flex items-center gap-1 group">Total Due Not Paid<HoverCard>
                                                            <HoverCardTrigger asChild>
                                                                <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                                                            </HoverCardTrigger>
                                                            <HoverCardContent className="text-xs w-auto p-1.5">
                                                                Total value of credit POs that are due but not yet paid.
                                                            </HoverCardContent>
                                                        </HoverCard>
                                                        </span>{" "}
                                                        <span className="text-red-600 font-semibold">
                                                            {formatToRoundedIndianRupee(
                                                                relatedTotalDue
                                                            )}
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
