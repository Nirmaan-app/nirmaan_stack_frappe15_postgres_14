// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";
// import { useOrderTotals } from "@/hooks/useOrderTotals";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { Vendors } from "@/types/NirmaanStack/Vendors";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from "lodash/memoize";
// import { useCallback, useContext, useMemo } from "react";
// import { Link } from "react-router-dom";

// export const ApproveSelectAmendSR: React.FC = () => {

//     const { getTotalAmount } = useOrderTotals()
//     const { data: service_request_list, isLoading: service_request_list_loading, error: service_request_list_error, mutate: sr_list_mutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
//         {
//             fields: ["*"],
//             filters: [["status", "=", "Amendment"]],
//             limit: 1000,
//             orderBy: { field: "creation", order: "desc" }
//         }
//     );

//     useFrappeDocTypeEventListener("Service Requests", async () => {
//         await sr_list_mutate()
//     })

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     })

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

//     const { data: vendorsList, isLoading: vendorsListLoading } = useFrappeGetDocList<Vendors>("Vendors", {
//         fields: ["vendor_name", 'vendor_type', 'name'],
//         filters: [["vendor_type", "in", ["Service", "Material & Service"]]],
//         limit: 1000
//     },
//         "Service Vendors"
//     )

//     const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList])

//     const { notifications, mark_seen_notification } = useNotificationStore()

//     const { db } = useContext(FrappeContext) as FrappeConfig

//     const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
//         if (notification) {
//             mark_seen_notification(db, notification)
//         }
//     }, [db, mark_seen_notification]);

//     const getVendorName = useMemo(() => memoize((vendorId: string | undefined) => {
//         return vendorsList?.find(vendor => vendor.name === vendorId)?.vendor_name || "";
//     }, (vendorId: string | undefined) => vendorId), [vendorsList])

//     const columns: ColumnDef<ServiceRequests>[] = useMemo(
//         () => [
//             {
//                 accessorKey: "name",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="ID" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const data = row.original
//                     const srId = data?.name
//                     const isNew = notifications.find(
//                         (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:amended"
//                     )
//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex items-center gap-2">
//                                 <Link
//                                     className="underline hover:underline-offset-2"
//                                     to={`${srId}?tab=approve-amended-so`}
//                                 >
//                                     {srId?.slice(-5)}
//                                 </Link>
//                                 <ItemsHoverCard order_list={data.service_order_list.list} isSR />
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
//                             {formatDate(row.getValue("creation")?.split(" ")[0])}
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

//                     return (
//                         <div className="font-medium">
//                             {project?.label || "--"}
//                         </div>
//                     )
//                 },
//                 filterFn: (row, id, value) => {
//                     return value.includes(row.getValue(id))
//                 },
//             },
//             {
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
//                 accessorKey: "total",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Estimated Price" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {formatToRoundedIndianRupee(getTotalAmount(row.getValue("name"), 'Service Requests')?.totalWithTax)}
//                         </div>
//                     )
//                 }
//             }
//         ],
//         [service_request_list, project_values, vendorsList, vendorOptions, getTotalAmount]
//     )

//     const { toast } = useToast()

//     if (service_request_list_error || projects_error) {
//         console.log("Error in approve-select-sent-back.tsx", service_request_list_error?.message, projects_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${service_request_list_error?.message || projects_error?.message}`,
//             variant: "destructive"
//         })
//     }


//     return (
//         <div className="flex-1 md:space-y-4">
//             {(service_request_list_loading || projects_loading || vendorsListLoading) ? (<TableSkeleton />) : (
//                 <DataTable columns={columns} data={service_request_list || []} project_values={project_values} vendorOptions={vendorOptions} />
//             )}
//         </div>
//     )
// }

// export default ApproveSelectAmendSR;




import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Checkbox } from "@/components/ui/checkbox";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";


// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useOrderTotals } from "@/hooks/useOrderTotals";


// --- Constants ---
const DOCTYPE = 'Service Requests';
const URL_SYNC_KEY = 'sr_amend_approve'; // Unique key for this table instance

// --- Component ---
export const ApproveSelectAmendSR: React.FC = () => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { getTotalAmount } = useOrderTotals()

    const projectsFetchOptions = getProjectListOptions();
            
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendorsList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({vendorTypes: ["Service"]});
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();
    const { notifications, mark_seen_notification } = useNotificationStore();

    // --- Memoized Options & Calculations ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);
    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList]);

    const getVendorName = useCallback(memoize((vendorId: string | undefined): string => {
        return vendorsList?.find(vendor => vendor.name === vendorId)?.vendor_name || vendorId || "--";
    }), [vendorsList]);


    // --- Notification Handling ---
    const handleNewSRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification);
        }
    }, [db, mark_seen_notification]);


    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["status", "=", "Amendment"] // Filter for SRs in "Amendment" status
    ], []);


    // --- Fields to Fetch ---
    const fieldsToFetch: (keyof ServiceRequests | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "vendor", // Selected vendor on the amended SR
        "service_category_list", "status", "service_order_list"
    ], []);


    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "vendor", "status", "owner"
    ], []);

     // --- Date Filter Columns ---
     const dateColumns = useMemo(() => ["creation", "modified"], []);

    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ServiceRequests>[]>(() => [
        {
            id: 'select',
            header: ({ table }) => (
                <Checkbox
                    disabled={true}
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows"
                    className="data_table_select-all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    disabled={true}
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
                    (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:amended" // Ensure correct event_id
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && ( <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" /> )}
                        {/* Link to the page where Amended SR can be approved */}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/service-requests/${srId}?tab=approve-amended-so`} >
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
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
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
             accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
             cell: ({ row }) => {
                 const ownerUser = userList?.find((entry) => row.original?.owner === entry.name);
                 return (<div className="font-medium truncate">{ownerUser?.full_name || row.original?.owner || "--"}</div>);
             }, size: 180,
        },
        {
            id: "amended_sr_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Amended Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotalAmount(row.original.name, 'Service Requests')?.totalWithTax)}</p>),
            size: 150, enableSorting: false,
        }
    ], [notifications, projectOptions, vendorOptions, userList, handleNewSRSeen, getVendorName, getTotalAmount]);


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        vendor: { title: "Vendor", options: vendorOptions },
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
        enableItemSearch: true, // If searching within service_order_list is needed
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // For bulk approval
        additionalFilters: staticFilters,
    });

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} (ApproveSelectAmendSR):`, event);
        refetch();
        toast({ title: "Amended Service Requests list updated.", duration: 2000 });
        // Refetch if the updated doc status is "Amendment"
        // if (event.doc && event.doc.status === "Amendment") {
        //      refetch();
        //      toast({ title: "Amended Service Requests list updated.", duration: 2000 });
        // } else if (event.doctype === DOCTYPE && !event.doc?.status) {
        //     refetch();
        // }
    });


    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || vendorsLoading || userListLoading;
    const combinedError = projectsError || vendorsError || userError || listError;

    if (combinedError) {
        toast({ title: "Error loading data", description: combinedError.message, variant: "destructive" });
    }

    return (
        <div className="flex-1 md:space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<ServiceRequests>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search Amended SRs..."
                    showItemSearchToggle={showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Service Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    // showExport={true} // Enable if needed
                    // toolbarActions={<Button size="sm">Bulk Approve Amended...</Button>} // Placeholder
                />
            )}
        </div>
    );
};

export default ApproveSelectAmendSR;