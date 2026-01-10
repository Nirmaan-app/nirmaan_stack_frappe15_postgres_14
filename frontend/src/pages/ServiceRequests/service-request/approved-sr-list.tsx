import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useFacetValues } from '@/hooks/useFacetValues';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceItemType, ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { SRRemarksPopover } from "@/pages/ServiceRequests/approved-sr/components/SRRemarksPopover";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { parseNumber } from "@/utils/parseNumber";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { DEFAULT_SR_FIELDS_TO_FETCH, SR_DATE_COLUMNS, SR_SEARCHABLE_FIELDS } from "../config/srTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { ExceptionMap } from "antd/es/result";
import { useUserData } from "@/hooks/useUserData";

// --- Constants ---
const DOCTYPE = 'Service Requests';

interface ApprovedSRListProps {
    for_vendor?: string; // Vendor ID to filter by
    // Add other props that might define the context/tab for this list
    // e.g., if this component is used in multiple places with different base filters
    urlSyncKeySuffix?: string; // To make URL keys unique if used multiple times on one page
}

export const SR_GST_OPTIONS_MAP = [
    { label: "Yes", value: "true" },
    { label: "No", value: "false" },
];

// --- Component ---
export const ApprovedSRList: React.FC<ApprovedSRListProps> = ({
    for_vendor = undefined,
    urlSyncKeySuffix = 'approved' // Default suffix
}) => {
    const { role } = useUserData();
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { getTotalAmount } = useOrderTotals()

    // Unique URL key for this instance of the table
    const urlSyncKey = useMemo(() => `sr_${urlSyncKeySuffix}`, [urlSyncKeySuffix]);

    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendorsList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({ vendorTypes: ["Service", "Material & Service"] });

    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList(); // For owner display
    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>(
        "Project Payments", { fields: ["name", "document_name", "status", "amount"], limit: 100000 }
    );
    const { notifications, mark_seen_notification } = useNotificationStore();

    // --- Memoized Options & Calculations ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);
    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList]);

    // Memoized function to get vendor name by ID
    const getVendorName = useCallback(memoize((vendorId: string | undefined): string => {
        return vendorsList?.find(vendor => vendor.name === vendorId)?.vendor_name || vendorId || "--";
    }), [vendorsList]);

    const getAmountPaidForSR = useMemo(() => {
        if (!projectPayments) return () => 0;
        const paymentsMap = new Map<string, number>();
        projectPayments.forEach(p => {
            if (p.document_name && p.status === "Paid") {
                const currentTotal = paymentsMap.get(p.document_name) || 0;
                paymentsMap.set(p.document_name, currentTotal + parseNumber(p.amount));
            }
        });
        return memoize((id: string) => paymentsMap.get(id) || 0, (id: string) => id);
    }, [projectPayments]);


    // --- Notification Handling ---
    const handleNewSRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);


    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => {
        const filters: Array<[string, string, string | string[]]> = [["status", "=", "Approved"]];
        if (for_vendor) {
            filters.push(["vendor", "=", for_vendor]);
        }
        return filters;
    }, [for_vendor]);


    // --- Fields to Fetch ---
    const fieldsToFetch = useMemo(() => DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation", "modified", 'service_order_list', 'service_category_list', 'total_amount', 'amount_paid', 'gst'
    ]), [])

    const srSearchableFields = useMemo(() => SR_SEARCHABLE_FIELDS.concat([
        { value: "owner", label: "Created By", placeholder: "Search by Created By..." },
    ]), [])

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => SR_DATE_COLUMNS, []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ServiceRequests>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#WO" />,
            cell: ({ row }) => {
                const data = row.original;
                const srId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:approved"
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && (<p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />)}
                        {role === "Nirmaan Project Manager Profile" ? srId?.slice(-5) :
                            (<Link className="underline hover:underline-offset-2 whitespace-nowrap"
                                to={for_vendor ? `/service-requests/${srId}?tab=approved-sr` : `/service-requests/${srId}?tab=approved-sr`} >
                                {srId?.slice(-5)}
                            </Link>)
                        }
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ItemsHoverCard parentDocId={data} parentDoctype="Service Requests" childTableName="service_order_list" isSR />
                        </div>
                    </div>
                );
            }, size: 150,
            meta: {
                exportHeaderName: "#WO",
                exportValue: (row) => {
                    return row.name;
                }
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created on" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Created on",
                exportValue: (row) => {
                    return formatDate(row.creation);
                }
            }
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
                // Display project_name if fetched, otherwise fallback to project ID
                return <div className="font-medium truncate" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Project",
                exportValue: (row) => {
                    const project = projectOptions.find(p => p.value === row.project);
                    return project?.label || row.project;
                }
            }
        },
        {
            accessorKey: "vendor", // Filter by vendor ID
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => <div className="font-medium truncate" title={getVendorName(row.original.vendor)}>{getVendorName(row.original.vendor)}</div>,
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Vendor",
                exportValue: (row) => {
                    return getVendorName(row.vendor);
                }
            }
        },
        {
            accessorKey: "service_category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.getValue("service_category_list") as { list: { name: string }[] } | undefined;
                const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
                return (
                    <div className="flex flex-wrap gap-1 items-start justify-start max-w-[200px]">
                        {categoryItems.length > 0 ? categoryItems.map((obj) => <Badge key={obj.name} variant="outline" className="text-xs">{obj.name}</Badge>) : '--'}
                    </div>
                );
            }, size: 180, enableSorting: false,
            meta: {
                excludeFromExport: true,
            }
        },
        {
            accessorKey: "total_amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Total SR Value" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(row.original.total_amount)}</div>, // Example badge
            enableColumnFilter: true, size: 120,
        },
        {
            accessorKey: "gst", header: ({ column }) => <DataTableColumnHeader column={column} title="Incl. GST" />,
            cell: ({ row }) => <Badge variant={row.original.gst === "true" ? "green" : "outline"}>{row.original.gst === "true" ? "YES" : "NO"}</Badge>, // Example badge
            enableColumnFilter: true, size: 120,
        },
        // {
        //     id: "service_total_amount", header: ({ column }) => <DataTableColumnHeader column={column} title="SR Value" />,
        //     cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotalAmount(row.original.name, 'Service Requests')?.totalWithTax)}</p>),
        //     size: 150, enableSorting: false,
        //     meta: {
        //         exportHeaderName: "SR Value",
        //         exportValue: (row) => {
        //             return formatForReport(getTotalAmount(row.name, 'Service Requests')?.totalWithTax);
        //         }
        //     }
        // },
        {
            accessorKey: "amount_paid", header: ({ column }) => <DataTableColumnHeader column={column} title="Amt. Paid" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(row.original.amount_paid)}</div>, // Example badge
            enableColumnFilter: true, size: 120,
        },
        {
            id: "remarks",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Remarks" />,
            cell: ({ row }) => <SRRemarksPopover srId={row.original.name} />,
            size: 100,
            enableSorting: false,
        },
        // {
        //     id: "amount_paid_sr", header: ({ column }) => <DataTableColumnHeader column={column} title="Amt Paid" />,
        //     cell: ({ row }) => {
        //         const amountPaid = getAmountPaidForSR(row.original.name);
        //         return <div className="font-medium pr-2">{formatToRoundedIndianRupee(amountPaid || 0)}</div>;
        //     }, size: 150, enableSorting: false,
        //     meta: {
        //         exportHeaderName: "Amt Paid",
        //         exportValue: (row) => {
        //             const amountPaid = getAmountPaidForSR(row.name);
        //             return formatForReport(amountPaid || 0);
        //         }
        //     }
        // },
    ], [notifications, projectOptions, vendorOptions, userList, handleNewSRSeen, getVendorName, for_vendor]); //, getTotalAmount, getAmountPaidForSR, 

    // --- (MOVED UP) Use the Server Data Table Hook ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        // globalFilter, setGlobalFilter,
        // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
        columnFilters // NEW
    } = useServerDataTable<ServiceRequests>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        searchableFields: srSearchableFields,
        // globalSearchFieldList: globalSearchFields,
        // enableItemSearch: true, // Can search within service_order_list items
        urlSyncKey: urlSyncKey,
        defaultSort: 'modified desc',
        enableRowSelection: true, // Or true if bulk actions needed for approved SRs
        additionalFilters: staticFilters,
        // requirePendingItems: false, // Not applicable for "Approved" SR list
    });

    // --- Dynamic Facet Values ---
    const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'project',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'vendor',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: !for_vendor // Disable dynamic fetch if vendor is already fixed
    });

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectFacetOptions, isLoading: isProjectFacetLoading },
        vendor: { title: "Vendor", options: vendorFacetOptions, isLoading: isVendorFacetLoading }, // Filter by vendor ID
        gst: { title: "GST", options: SR_GST_OPTIONS_MAP },
    }), [projectFacetOptions, isProjectFacetLoading, vendorFacetOptions, isVendorFacetLoading]);


    // --- Faceted Filter Options ---



    // --- Use the Server Data Table Hook ---


    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || vendorsLoading || userListLoading || projectPaymentsLoading;
    const combinedError = projectsError || vendorsError || userError || projectPaymentsError || listError;

    if (combinedError) {
        return <AlertDestructive error={combinedError} />
    }

    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-80px)] overflow-hidden' : ''}`}>
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<ServiceRequests>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading} // Pass specific loading state for table data
                    error={listError} // Pass specific error state for table data
                    totalCount={totalCount}
                    searchFieldOptions={srSearchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder="Search Approved SRs..."
                    // showItemSearchToggle={showItemSearchToggle}
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Service Item Search"
                    // }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    onExport={'default'}
                />
            )}
        </div>
    );
};

export default ApprovedSRList;