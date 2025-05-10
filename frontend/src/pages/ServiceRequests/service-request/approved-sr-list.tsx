// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { Badge } from "@/components/ui/badge";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";
// import { useOrderTotals } from "@/hooks/useOrderTotals";
// import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { Vendors } from "@/types/NirmaanStack/Vendors";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
// import { getTotalAmountPaid } from "@/utils/getAmounts";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { Filter, FrappeConfig, FrappeContext, FrappeDoc, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from "lodash/memoize";
// import { useCallback, useContext, useMemo } from "react";
// import { Link } from "react-router-dom";

// interface ApprovedSRListProps {
//     for_vendor?: string
// }

// export const ApprovedSRList : React.FC<ApprovedSRListProps> = ({ for_vendor = undefined }) => {

//     const {getTotalAmount} = useOrderTotals()
//     const sr_filters: Filter<FrappeDoc<ServiceRequests>>[] | undefined = [["status", "=", "Approved"]]
//     if (for_vendor) {
//         sr_filters.push(["vendor", "=", for_vendor])
//     }
//     const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
//         {
//             fields: ["*"],
//             filters: sr_filters,
//             limit: 1000,
//             orderBy: { field: "modified", order: "desc" }
//         });

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     }, 'Projects')

//     const { data: projectPayments, isLoading: projectPaymentsLoading } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
//         fields: ["*"],
//         limit: 100000
//     })

//     const { data: vendorsList, isLoading: vendorsListLoading } = useFrappeGetDocList<Vendors>("Vendors", {
//         fields: ["vendor_name", 'vendor_type', 'name'],
//         filters: [["vendor_type", "in", ["Service", "Material & Service"]]],
//         limit: 1000
//     },
//         "Service Vendors"
//     )

//     const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList])


//     useFrappeDocTypeEventListener("Service Requests", async () => {
//         await serviceListMutate()
//     })

//     const project_values = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name})) || [], [projects])

//     const getAmountPaid = useMemo(() => memoize((id : string) => {
//         const payments = projectPayments?.filter((payment) => payment?.document_name === id && payment?.status === "Paid") || [];
//         return getTotalAmountPaid(payments)
//     }, (id: string) => id), [projectPayments])

//     const { notifications, mark_seen_notification } = useNotificationStore()

//     const { db } = useContext(FrappeContext) as FrappeConfig

//     const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
//         if (notification) {
//             mark_seen_notification(db, notification)
//         }
//     }, [db, mark_seen_notification])

//     const getVendorName = useCallback((vendorId: string | undefined) => {
//         return vendorsList?.find(vendor => vendor.name === vendorId)?.vendor_name || "";
//     }, [vendorsList])

//     const columns : ColumnDef<ServiceRequests>[] = useMemo(
//         () => [
//             {
//                 accessorKey: "name",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="SR Number" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const data = row.original
//                     const srId = data?.name
//                     const isNew = notifications.find(
//                         (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:approved"
//                     )
//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex items-center gap-2">
//                             <Link
//                                 className="underline hover:underline-offset-2"
//                                 to={for_vendor === undefined ? `${srId}?tab=approved-sr` : `/service-requests-list/${srId}`}
//                             >
//                                 {srId?.slice(-5)}
//                             </Link>
//                             <ItemsHoverCard order_list={data.service_order_list.list} isSR />
//                             </div>
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "creation",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Date Created" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {formatDate(row.getValue("creation"))}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "project",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Project" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const project = project_values.find(
//                         (project) => project.value === row.getValue("project")
//                     )
//                     if (!project) {
//                         return null;
//                     }

//                     return (
//                         <div className="font-medium">
//                             {project.label}
//                         </div>
//                     )
//                 },
//                 filterFn: (row, id, value) => {
//                     return value.includes(row.getValue(id))
//                 },
//             },
//             {
//                 // accessorKey: "vendor",
//                 id: "vendor_name",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Vendor" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {getVendorName(row.original.vendor)}
//                         </div>
//                     )
//                 },
//                 filterFn: (row, id, value) => {
//                     return value.includes(row.original.vendor)
//                 }
//             },
//             {
//                 accessorKey: "service_category_list",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Categories" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="flex flex-col gap-1 items-start justify-center">
//                             {row.getValue("service_category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "total",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Total PO Amt" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {formatToRoundedIndianRupee(getTotalAmount(row.getValue("name"), 'Service Requests')?.totalWithTax)}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 id: "Amount_paid",
//                 header: "Amt Paid",
//                 cell: ({ row }) => {
//                     const data = row.original
//                     const amountPaid = getAmountPaid(data?.name);
//                     return <div className="font-medium">
//                         {formatToRoundedIndianRupee(amountPaid || "--")}
//                     </div>
//                 },
//             },

//         ],
//         [project_values, service_list, projectPayments, vendorsList, vendorOptions, getTotalAmount, getAmountPaid]
//     )
//     const { toast } = useToast()

//     if (service_list_error || projects_error) {
//         console.log("Error in approved-sr-list.tsx", service_list_error?.message, projects_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${service_list_error?.message || projects_error?.message}`,
//             variant: "destructive"
//         })
//     }

//     return (
//         <div className="flex-1 space-y-4">
//             {(projects_loading || service_list_loading || vendorsListLoading || projectPaymentsLoading) ? (<TableSkeleton />) : (
//                 <DataTable columns={columns} data={service_list || []} project_values={project_values} vendorOptions={vendorOptions} />
//             )}
//         </div>
//     )
// }

// export default ApprovedSRList;






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
import { Checkbox } from "@/components/ui/checkbox";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceItemType, ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { parseNumber } from "@/utils/parseNumber";
import { useOrderTotals } from "@/hooks/useOrderTotals";

// --- Constants ---
const DOCTYPE = 'Service Requests';

interface ApprovedSRListProps {
    for_vendor?: string; // Vendor ID to filter by
    // Add other props that might define the context/tab for this list
    // e.g., if this component is used in multiple places with different base filters
    urlSyncKeySuffix?: string; // To make URL keys unique if used multiple times on one page
}

// --- Component ---
export const ApprovedSRList: React.FC<ApprovedSRListProps> = ({
    for_vendor = undefined,
    urlSyncKeySuffix = 'approved' // Default suffix
}) => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const {getTotalAmount} = useOrderTotals()

    // Unique URL key for this instance of the table
    const urlSyncKey = useMemo(() => `sr_${urlSyncKeySuffix}`, [urlSyncKeySuffix]);

    const projectsFetchOptions = getProjectListOptions();
                
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendorsList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({vendorTypes: ["Service"]});
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
    const fieldsToFetch: (keyof ServiceRequests | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "vendor", // Fetch vendor ID
        "service_category_list", "status", "service_order_list"
    ], []);


    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "vendor", // Search by vendor ID (backend can fetch vendor_name if needed or we map on client)
        "status", "owner"
    ], []);

     // --- Date Filter Columns ---
     const dateColumns = useMemo(() => ["creation", "modified"], []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ServiceRequests>[]>(() => [
        {
            id: 'select',
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows"
                    className="data_table_select-all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="data_table_select-row"
                />
            ),
            enableSorting: false,
            enableHiding: false,
            size: 40,
        },
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#SR" />,
            cell: ({ row }) => {
                const data = row.original;
                const srId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:approved"
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && ( <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" /> )}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap"
                              to={for_vendor ? `/vendor-portal/service-requests/${srId}` : `/service-requests/${srId}?tab=approved-sr`} >
                            {srId?.slice(-5)}
                        </Link>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                           <ItemsHoverCard order_list={Array.isArray(data.service_order_list?.list) ? data.service_order_list.list : []} isSR />
                        </div>
                    </div>
                );
            }, size: 150,
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
                // Display project_name if fetched, otherwise fallback to project ID
                return <div className="font-medium truncate" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 200,
        },
        {
            accessorKey: "vendor", // Filter by vendor ID
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => <div className="font-medium truncate" title={getVendorName(row.original.vendor)}>{getVendorName(row.original.vendor)}</div>,
            enableColumnFilter: true, size: 200,
        },
        {
            accessorKey: "service_category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.getValue("service_category_list") as { list: {name : string}[] } | undefined;
                const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
                return (
                    <div className="flex flex-wrap gap-1 items-start justify-start max-w-[200px]">
                        {categoryItems.length > 0 ? categoryItems.map((obj) => <Badge key={obj.name} variant="outline" className="text-xs">{obj.name}</Badge>) : '--'}
                    </div>
                );
            }, size: 180, enableSorting: false,
        },
        {
            id: "service_total_amount", header: ({ column }) => <DataTableColumnHeader column={column} title="SR Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotalAmount(row.original.name, 'Service Requests')?.totalWithTax)}</p>),
            size: 150, enableSorting: false,
        },
        {
            id: "amount_paid_sr", header: ({column}) => <DataTableColumnHeader column={column} title="Amt Paid" /> ,
            cell: ({ row }) => {
                const amountPaid = getAmountPaidForSR(row.original.name);
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(amountPaid || 0)}</div>;
            }, size: 150, enableSorting: false,
        },
    ], [notifications, projectOptions, vendorOptions, userList, handleNewSRSeen, getVendorName, getTotalAmount, getAmountPaidForSR, for_vendor]);


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        vendor: { title: "Vendor", options: vendorOptions }, // Filter by vendor ID
    }), [projectOptions, vendorOptions]);


    // --- Use the Server Data Table Hook ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        globalFilter, setGlobalFilter,
        isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
        refetch,
    } = useServerDataTable<ServiceRequests>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        globalSearchFieldList: globalSearchFields,
        enableItemSearch: true, // Can search within service_order_list items
        urlSyncKey: urlSyncKey,
        defaultSort: 'modified desc',
        enableRowSelection: true, // Or true if bulk actions needed for approved SRs
        additionalFilters: staticFilters,
        // requirePendingItems: false, // Not applicable for "Approved" SR list
    });

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} (ApprovedSRList - for_vendor: ${for_vendor}):`, event);
        refetch();
        toast({ title: "Approved Service Requests list updated.", duration: 2000 });
        // Refetch if the updated doc status is "Approved" and matches vendor filter if present
        // if (event.doc && event.doc.status === "Approved") {
        //     if (for_vendor && event.doc.vendor === for_vendor) {
        //         refetch();
        //         toast({ title: "Approved Service Requests list updated.", duration: 2000 });
        //     } else if (!for_vendor) {
        //         refetch();
        //         toast({ title: "Approved Service Requests list updated.", duration: 2000 });
        //     }
        // } else if (event.doctype === DOCTYPE && !event.doc?.status) { // Generic update like delete
        //      refetch();
        // }
    });

    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || vendorsLoading || userListLoading || projectPaymentsLoading;
    const combinedError = projectsError || vendorsError || userError || projectPaymentsError || listError;

    if (combinedError) {
        toast({ title: "Error loading data", description: combinedError.message, variant: "destructive" });
    }

    return (
        <div className="flex-1 space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<ServiceRequests>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading} // Pass specific loading state for table data
                    error={listError} // Pass specific error state for table data
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search Approved SRs..."
                    showItemSearchToggle={showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Service Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExport={true}
                    onExport={() => console.log("exported")}
                />
            )}
        </div>
    );
};

export default ApprovedSRList;