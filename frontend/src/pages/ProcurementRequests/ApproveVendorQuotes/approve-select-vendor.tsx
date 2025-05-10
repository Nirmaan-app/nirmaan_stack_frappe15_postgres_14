// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { Badge } from "@/components/ui/badge";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";
// import { Category, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from "lodash/memoize";
// import { useCallback, useContext, useMemo } from "react";
// import { Link } from "react-router-dom";

// export const ApproveSelectVendor : React.FC = () => {

//     const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: pr_list_mutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
//         {
//             fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'category_list', 'creation', "modified"],
//             filters: [
//                 ["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]
//             ],
//             limit: 1000,
//             orderBy: {field: "modified", order: "desc"}
//         });

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     }, "Projects")


//     const getTotal = useMemo(() => memoize((order_id: string) => {
//         let total: number = 0;
//         const allItems = procurement_request_list?.find(item => item?.name === order_id)?.procurement_list?.list;
//         const orderData = allItems?.filter((item) => item.status === "Pending")
//         orderData?.map((item) => {
//             total += parseNumber((item.quote || 0) * item.quantity);
//         })
//         return total;
//     }, (order_id: string) => order_id), [procurement_request_list])

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

//     useFrappeDocTypeEventListener("Procurement Requests", async () => {
//         await pr_list_mutate()
//     })

//     const {notifications, mark_seen_notification} = useNotificationStore()

//     const {db} = useContext(FrappeContext) as FrappeConfig
//     const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
//         if(notification) {
//             mark_seen_notification(db, notification)
//         }
//     }, [db, mark_seen_notification])

//     const columns: ColumnDef<ProcurementRequest>[] = useMemo(
//         () => [
//             {
//                 accessorKey: "name",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="#PR" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const data = row.original
//                     const prId : string = data.name
//                     const isNew = notifications.find(
//                         (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:vendorSelected"
//                     )
//                     return (
//                         <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex items-center gap-2">
//                                 <Link
//                                     className="underline hover:underline-offset-2"
//                                     to={`${prId}?tab=Approve PO`}
//                                 >
//                                     {prId?.slice(-4)}
//                                 </Link>
//                                  {!data.work_package && <Badge className="text-xs">Custom</Badge>}
//                                  <ItemsHoverCard order_list={data?.procurement_list?.list} isPR />
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
//                      const creation : string = row.getValue("creation")
//                     return (
//                         <p className="font-medium">
//                             {formatDate(creation)}
//                         </p>
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
//                         <p className="font-medium">
//                             {project?.label || "--"}
//                         </p>
//                     )
//                 },
//                 filterFn: (row, id, value) => {
//                     return value.includes(row.getValue(id))
//                 },
//             },
//             {
//                 accessorKey: "work_package",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Package" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <p className="font-medium">
//                             {row.getValue("work_package") || "--"}
//                         </p>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "category_list",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Categories" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const categories : { list : Category[] } = row.getValue("category_list")
//                     return (
//                         <p className="flex flex-col gap-1 items-start justify-center">
//                             {categories.list.map((obj) => <Badge key={obj.name} className="inline-block">{obj.name}</Badge>)}
//                         </p>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "total",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Estimated Price" />
//                     )
//                 },
//                 cell: ({row}) => {
//                     const id : string = row.getValue("name")
//                     return (
//                         <p className="font-medium">
//                             {getTotal(id) === 0 ? "N/A" : formatToRoundedIndianRupee(getTotal(id))}
//                         </p>
//                     )
//                 }
//             }

//         ],
//         [procurement_request_list, notifications, project_values, getTotal]
//     )

//     const { toast } = useToast()

//     if (procurement_request_list_error || projects_error) {
//         console.log("Error in approve-select-vendor.tsx", procurement_request_list_error?.message, projects_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
//             variant: "destructive"
//         })
//     }

//     return (
//         <div className="flex-1 md:space-y-4">
//             {(projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
//                 <DataTable columns={columns} data={procurement_request_list?.filter((item) => item.procurement_list?.list?.some((i) => i.status === "Pending")) || []} project_values={project_values} />
//             )}
//         </div>
//     )
// }

// export default ApproveSelectVendor;


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
import { ProcurementRequest, ProcurementItem, Category } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "../ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";

// --- Constants ---
const DOCTYPE = 'Procurement Requests';
const URL_SYNC_KEY = 'pr_approve'; // Unique key for this specific table instance/view

// --- Component ---
export const ApproveSelectVendor: React.FC = () => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    const projectsFetchOptions = getProjectListOptions();
        
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList(); // Keep for owner display
    const { notifications, mark_seen_notification } = useNotificationStore(); // For notification badges

    // --- Memoized Calculations & Options ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);

    const getTotal = useMemo(() => memoize((procurementList: { list: ProcurementItem[] } | undefined | null): number => {
        let total = 0;
        const items = Array.isArray(procurementList?.list) ? procurementList.list : [];
        const pendingItems = items.filter((item) => item.status === "Pending"); // Calculation based on pending items
        pendingItems.forEach((item) => {
            total += parseNumber((item.quote || 0) * item.quantity); // Use quote or rate if available
        });
        return total;
    }), []); // No external dependency needed if list is passed in

    // --- Notification Handling ---
    const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") { // Only mark if not seen
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);

    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]
    ], []);

    // --- Fields to Fetch ---
    const fieldsToFetch: (keyof ProcurementRequest | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "work_package", "procurement_list", "category_list", "workflow_state" // Fetch workflow_state if needed for display/logic
    ], []);

    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "work_package", "owner"
        // Add other relevant text fields from PR
    ], []);

     // --- Date Filter Columns ---
     const dateColumns = useMemo(() => ["creation", "modified"], []);

    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProcurementRequest>[]>(() => [
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
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#PR" />,
            cell: ({ row }) => {
                const data = row.original;
                const prId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:vendorSelected" // Assuming this event ID
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative group"> {/* Added group for hover effect */}
                        {isNew && ( <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" /> )}
                        <Link className="underline hover:underline-offset-2" to={`/purchase-orders/${prId}?tab=Approve PO`} >
                            {prId?.slice(-4)} {/* Display last 4 chars */}
                        </Link>
                        {!data.work_package && <Badge className="text-xs">Custom</Badge>}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity"> {/* Show hover card on group hover */}
                           <ItemsHoverCard order_list={Array.isArray(data.procurement_list?.list) ? data.procurement_list.list : []} isPR />
                        </div>
                    </div>
                );
            }, size: 150, // Adjusted size
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(i => i.value === row.original.project);
            return <div className="font-medium truncate" title={project?.label}>{project?.label}</div> },
            enableColumnFilter: true, size: 200, // Enable faceted filter
        },
        {
            accessorKey: "work_package", header: ({ column }) => <DataTableColumnHeader column={column} title="Package" />,
            cell: ({ row }) => <div className="font-medium truncate">{row.getValue("work_package") || "--"}</div>,
             size: 150,
        },
        {
            accessorKey: "category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.getValue("category_list") as { list: Category[] } | undefined;
                const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
                return (
                    <div className="flex flex-wrap gap-1 items-start justify-start">
                        {categoryItems.length > 0
                            ? categoryItems.map((obj) => <Badge key={obj.name} variant="outline" className="text-xs">{obj.name}</Badge>)
                            : '--'}
                    </div>
                );
            }, size: 180, enableSorting: false,
        },
        {
             accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
             cell: ({ row }) => {
                 const ownerUser = userList?.find((entry) => row.original?.owner === entry.name);
                 return (<div className="font-medium truncate">{ownerUser?.full_name || row.original?.owner || "--"}</div>);
             }, size: 180,
        },
        {
            id: "estimated_total", header: ({ column }) => <DataTableColumnHeader column={column} title="Est. Value" />,
            cell: ({ row }) => {
                const total = getTotal(row.original.procurement_list);
                return <p className="font-medium text-right pr-2">{total === 0 ? "N/A" : formatToRoundedIndianRupee(total)}</p>;
            }, size: 150, enableSorting: false,
        }

    ], [notifications, projectOptions, userList, handleNewPRSeen, getTotal]); // Added dependencies


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        // Add other facets if needed, e.g., work_package if you fetch distinct values
    }), [projectOptions]);

    // --- Use the Server Data Table Hook ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        globalFilter, setGlobalFilter,
        isItemSearchEnabled, toggleItemSearch, showItemSearchToggle, // Use item search state
        refetch,
    } = useServerDataTable<ProcurementRequest>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        // defaultSearchField: "name", // Removed
        globalSearchFieldList: globalSearchFields, // For default global search
        enableItemSearch: true, // Enable item search feature for PRs
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc', // Sort by modified desc by default
        enableRowSelection: false, // No selection needed for this view? Adjust if needed.
        additionalFilters: staticFilters,
        // --- NEW: Add the specific filter flag for this view ---
        requirePendingItems: true,
        // ------------------------------------------------------
    });


    useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
        const handleRealtimeUpdate = (eventData: any) => {
            console.log(`Realtime event received for ${DOCTYPE}:`, eventData);
            // Optionally check if the update is relevant (e.g., based on workflow_state)
            // For simplicity, refetch on any relevant doctype event
             refetch();
             toast({ title: "Procurement Requests updated.", duration: 2000 });
        };
        handleRealtimeUpdate(event);
    });

    // --- Realtime Update Handling ---
    // Replace the useFrappeDocTypeEventListener with logic using the hook's refetch
    // useEffect(() => {
    //     // Define the handler function
    //     const handleRealtimeUpdate = (eventData: any) => {
    //         console.log(`Realtime event received for ${DOCTYPE}:`, eventData);
    //         // Optionally check if the update is relevant (e.g., based on workflow_state)
    //         // For simplicity, refetch on any relevant doctype event
    //          refetch();
    //          toast({ title: "Procurement Requests updated.", duration: 2000 });
    //     };

    //     // Subscribe to relevant events
    //     frappe.realtime.on(`doc_update:${DOCTYPE}`, handleRealtimeUpdate); // When a PR is saved
    //     frappe.realtime.on(`doc_creation:${DOCTYPE}`, handleRealtimeUpdate); // If new relevant PRs can be created

    //     // Clean up subscriptions on unmount
    //     return () => {
    //         frappe.realtime.off(`doc_update:${DOCTYPE}`, handleRealtimeUpdate);
    //         frappe.realtime.off(`doc_creation:${DOCTYPE}`, handleRealtimeUpdate);
    //     };
    // }, [refetch, toast]); // Add toast to dependencies if used inside


    // --- Combined Loading State ---
    const isLoading = projectsLoading || userListLoading;
    const error = projectsError || userError || listError;


    if (error) {
        // Handle or display combined error state
        toast({ title: "Error loading data", description: error.message, variant: "destructive" });
        // You might want a more prominent error display than just a toast
        // return <div className="text-red-500 p-4">Error loading data: {error.message}</div>;
    }


    return (
        <div className="flex-1 md:space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProcurementRequest>
                    table={table}
                    columns={columns}
                    // data={data} // Data comes from the hook now
                    isLoading={listIsLoading} // Pass loading state from the hook
                    error={listError} // Pass error state from the hook
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search PRs..." // Specific placeholder
                    showItemSearchToggle={showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns} // Enable date filters for creation/modified
                    // showExport={false} // Disable export if not needed
                />
            )}
        </div>
    );
}

export default ApproveSelectVendor;