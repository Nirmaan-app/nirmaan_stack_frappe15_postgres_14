// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";
// import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
// import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
// import { Vendors } from "@/types/NirmaanStack/Vendors";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from "lodash/memoize";
// import { useCallback, useContext, useMemo } from "react";
// import { Link } from "react-router-dom";

// export const ApproveSelectAmendPO : React.FC = () => {

//     const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders",
//         {
//             fields: ["*"],
//             filters: [["status", "=", "PO Amendment"]],
//             limit: 1000,
//             orderBy: {field : "modified", order: "desc"}
//         },
//     );

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<ProjectsType>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     })

//     const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
//         fields: ["vendor_name", 'vendor_type'],
//         filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
//         limit: 10000
//     },
//         "Material Vendors"
//     )

//     useFrappeDocTypeEventListener("Procurement Orders", async (data) => {
//         await mutate()
//     })

//     const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.vendor_name })), [vendorsList])

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

//     const getTotal = useMemo(() => memoize((order_id: string) => {
//         let total: number = 0;
//         const orderData = procurement_order_list?.find(item => item.name === order_id)?.order_list;
//         orderData?.list.map((item) => {
//             const price = item.quote;
//             total += parseNumber(price * item.quantity);
//         })
//         return total;
//     }, (order_id: string) => order_id), [procurement_order_list])

//     const {notifications, mark_seen_notification} = useNotificationStore()


//     const {db} = useContext(FrappeContext) as FrappeConfig
//     const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
//         if(notification) {
//             mark_seen_notification(db, notification)
//         }
//     }, [db, mark_seen_notification])

//     const columns: ColumnDef<ProcurementOrdersType>[] = useMemo(
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
//                     const poId = data?.name
//                     const isNew = notifications.find(
//                         (item) => item.docname === poId && item.seen === "false" && item.event_id === "po:amended"
//                     )
//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex gap-1 items-center">
//                                 <Link
//                                     className="underline hover:underline-offset-2"
//                                     to={`${poId?.replaceAll("/", "&=")}?tab=Approve Amended PO`}
//                                 >
//                                     {poId?.toUpperCase()}
//                                 </Link>
//                             <ItemsHoverCard order_list={data?.order_list?.list} />
//                             </div>
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "procurement_request",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="PR Number" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("procurement_request")?.slice(-4)}
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
//                 accessorKey: "vendor_name",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Vendor" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("vendor_name")}
//                         </div>
//                     )
//                 },
//                 filterFn: (row, id, value) => {
//                     return value.includes(row.getValue(id))
//                 }
//             },
//             {
//                 accessorKey: "total",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Amount" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {formatToRoundedIndianRupee(getTotal(row.getValue("name")))}
//                         </div>
//                     )
//                 }
//             }
//         ],
//         [project_values, procurement_order_list, vendorOptions, getTotal]
//     )

//     const { toast } = useToast()

//     if (procurement_order_list_error || projects_error || vendorsError) {
//         console.log("Error in approve-select-amend-po.tsx", procurement_order_list_error?.message, projects_error?.message, vendorsError?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${procurement_order_list_error?.message || projects_error?.message || vendorsError?.message}`,
//             variant: "destructive"
//         })
//     }

//     return (
//             <div className="flex-1 md:space-y-4">
//                 {(procurement_order_list_loading || projects_loading || vendorsListLoading) ? (<TableSkeleton />) : (
//                     <DataTable columns={columns} data={procurement_order_list?.filter((po) => po.status !== "Cancelled") || []} project_values={project_values} vendorOptions={vendorOptions} />
//                 )}
//             </div>
//     )
// }

// export default ApproveSelectAmendPO;


import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { useToast } from "@/components/ui/use-toast";

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
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ProcurementOrder as ProcurementOrdersType, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";

// --- Constants ---
const DOCTYPE = 'Procurement Orders';
const URL_SYNC_KEY = 'po_amend_approve'; // Unique key for this table instance

// --- Component ---
export const ApproveSelectAmendPO: React.FC = () => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    const projectsFetchOptions = getProjectListOptions();
        
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<ProjectsType>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<ProjectsType>>, projectQueryKey
    );
    const { data: vendorsList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList();
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();
    const { notifications, mark_seen_notification } = useNotificationStore();

    // --- Memoized Calculations & Options ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);
    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList]);

    // Updated getTotal to work with the data structure directly
    const getTotal = useMemo(() => memoize((order: ProcurementOrdersType | undefined | null): number => {
        if (!order) return 0;
        let total = 0;
        const orderData = Array.isArray(order.order_list?.list) ? order.order_list.list : [];
        orderData.forEach((item) => {
            const price = item.quote;
            total += parseNumber(price * item.quantity);
        });
        // Add loading/freight if applicable for amended PO totals? Check requirements.
        // total += parseNumber(order.loading_charges) + parseNumber(order.freight_charges);
        return total;
    }), []);

    // --- Notification Handling ---
    const handleNewSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);

    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["status", "=", "PO Amendment"] // Filter specifically for "PO Amendment" status
    ], []);

    // --- Fields to Fetch ---
    // Include fields needed for display, calculations, links, filters
    const fieldsToFetch: (keyof ProcurementOrdersType | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project", "project_name",
        "vendor", "vendor_name", "procurement_request", "order_list", // fetch order_list for hover card and total calc
        "status", "custom", // Fetch status and custom flag
        "loading_charges", "freight_charges" // Fetch if needed for getTotal
    ], []);

    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "vendor", "procurement_request", "project_name", "vendor_name", "status", "owner"
    ], []);

     // --- Date Filter Columns ---
     const dateColumns = useMemo(() => ["creation", "modified"], []);

    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProcurementOrdersType>[]>(() => [
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
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#PO" />,
            cell: ({ row }) => {
                const data = row.original;
                const poId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === poId && item.seen === "false" && item.event_id === "po:amended" // Check correct event_id
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && ( <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" /> )}
                        {/* Ensure Link points to correct view/tab */}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/purchase-orders/${poId?.replaceAll("/", "&=")}?tab=Approve Amended PO`} >
                            {poId?.toUpperCase()}
                        </Link>
                        {/* Ensure order_list structure is correct for hover card */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                           <ItemsHoverCard order_list={Array.isArray(data.order_list?.list) ? data.order_list.list : []} />
                        </div>
                         {data?.custom === "true" && (<Badge className="text-xs">Custom</Badge>)}
                    </div>
                );
            }, size: 200,
        },
        {
            accessorKey: "procurement_request", header: ({ column }) => <DataTableColumnHeader column={column} title="#PR" />,
            cell: ({ row }) => (<div className="font-medium">{row.getValue("procurement_request")?.slice(-4) ?? '--'}</div>), // Display last 4 of PR
            size: 100,
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => <div className="font-medium truncate" title={row.original.project_name}>{row.original.project_name || row.original.project}</div>,
            enableColumnFilter: true, size: 200,
        },
        {
            accessorKey: "vendor", header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => <div className="font-medium truncate" title={row.original.vendor_name}>{row.original.vendor_name || row.original.vendor}</div>,
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
            id: "po_amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotal(row.original))}</p>),
            size: 150, enableSorting: false,
        }
    ], [notifications, projectOptions, vendorOptions, userList, handleNewSeen, getTotal]); // Updated dependencies


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
        refetch, // Get refetch function
    } = useServerDataTable<ProcurementOrdersType>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        globalSearchFieldList: globalSearchFields,
        enableItemSearch: true, // Enable item search for amended POs
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // Enable selection for potential bulk approval/rejection
        additionalFilters: staticFilters, // Filter by "PO Amendment" status
        // requirePendingItems: false // No need for this specific filter here
    });


    useFrappeDocTypeEventListener("Procurement orders", async (event) => {
        const handleRealtimeUpdate = (eventData: any) => {
            console.log(`Realtime event received for ${DOCTYPE}:`, eventData);
            // Optionally check if the update is relevant (e.g., based on workflow_state)
            // For simplicity, refetch on any relevant doctype event
             refetch();
             toast({ title: "Procurement Orders updated.", duration: 2000 });
        };
        handleRealtimeUpdate(event);
    });


    // --- Combined Loading State & Error Handling ---
    const isLoading = projectsLoading || vendorsLoading || userListLoading;
    const error = projectsError || vendorsError || userError || listError;

    if (error) {
        toast({ title: "Error loading data", description: error.message, variant: "destructive" });
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
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search Amended POs..."
                    showItemSearchToggle={showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    // showExport={true} // Enable if needed
                    // onExport={handleExport} // Define handleExport if needed
                    // toolbarActions={<Button size="sm">Bulk Actions...</Button>} // Placeholder for future actions
                />
            )}
        </div>
    );
}

export default ApproveSelectAmendPO;