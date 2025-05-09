// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { Badge } from "@/components/ui/badge";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";
// import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { formatDate } from "@/utils/FormatDate";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
// import React, { useCallback, useContext, useMemo } from "react";
// import { Link } from "react-router-dom";

// export const ApprovePR : React.FC = () => {

//     const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: pr_list_mutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
//         {
//             fields: ["*"],
//             filters: [["workflow_state", "=", "Pending"]],
//             limit: 1000,
//             orderBy: { field: "modified", order: "desc" }
//         },
//     );
//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects",
//         {
//             fields: ["name", "project_name"],
//             limit: 1000
//         },
//         `Projects`,
//     )

    
//     // const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
//     //     {
//     //         fields: ["*"],
//     //         limit: 100000
//     //     },
//     //     `Approved Quotations`
//     // );

//     useFrappeDocTypeEventListener("Procurement Requests", async (data) => {
//         await pr_list_mutate()
//     })

//     const { toast } = useToast()

//     const { notifications, mark_seen_notification } = useNotificationStore()

//     // console.log('quotes', quote_data)

//     // const getTotal = useMemo(() => memoize((order_id: string) => {
//     //     console.log("running getTotal, for", order_id)
//     //     let total: number = 0;
//     //     let usedQuotes = {}
//     //     const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
//     //     orderData?.list?.filter((i) => i.status !== "Request")?.map((item: any) => {
//     //         const minQuote = getThreeMonthsLowestFiltered(quote_data, item.name)
//     //         if (minQuote) {
//     //             const estimateQuotes = quote_data
//     //                 ?.filter(value => value.item_id === item.name && parseNumber(value.quote) === minQuote)?.sort((a, b) => new Date(b.modified) - new Date(a.modified)) || [];
//     //             const latestQuote = estimateQuotes?.length ? estimateQuotes[0] : null;
//     //             usedQuotes = { ...usedQuotes, [item.item]: { items: latestQuote, amount: minQuote, quantity: item.quantity } }
//     //         }
//     //         total += minQuote * item.quantity;
//     //     })
//     //     return { total: total || "N/A", usedQuotes: usedQuotes }
//     // }, (order_id: string) => order_id), [procurement_request_list, quote_data])

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

//     const { db } = useContext(FrappeContext) as FrappeConfig
//     const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
//         if (notification) {
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
//                     const prId = data?.name
//                     const isNew = notifications.find(
//                         (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:new"
//                     )
//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex items-center gap-1">
//                                 <Link
//                                     className="underline hover:underline-offset-2"
//                                     to={`${prId}?tab=Approve PR`}
//                                 >
//                                     {prId?.slice(-4)}
//                                 </Link>
//                                 <ItemsHoverCard order_list={data?.procurement_list?.list} isPR/>
//                             </div>
//                         </div>
//                     )
//                 },
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
//                 accessorKey: "work_package",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Package" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("work_package")}
//                         </div>
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
//                     const categories : Set<string> = new Set()
//                     const categoryList : {name : string}[]= row.getValue("category_list")?.list || []
//                     categoryList?.forEach((i) => {
//                         categories.add(i?.name)
//                     })

//                     return (
//                         <div className="flex flex-col gap-1 items-start justify-center">
//                             {Array.from(categories)?.map((obj) => <Badge className="inline-block">{obj}</Badge>)}
//                         </div>
//                     )
//                 }
//             },
//             // {
//             //     accessorKey: "total",
//             //     header: ({ column }) => {
//             //         return (
//             //             <DataTableColumnHeader column={column} title="Estimated Price" />
//             //         )
//             //     },
//             //     cell: ({ row }) => {
//             //         const total = getTotal(row.getValue("name")).total
//             //         const prUsedQuotes = getTotal(row.getValue("name"))?.usedQuotes
//             //         return (
//             //             total === "N/A" ? (
//             //                 <div className="font-medium">
//             //                     N/A
//             //                 </div>
//             //             ) : (
//             //                 <EstimatedPriceHoverCard total={total} prUsedQuotes={prUsedQuotes} />
//             //             )
//             //         )
//             //     }
//             // }
//         ],
//         [project_values, notifications, procurement_request_list]
//     )

//     if (procurement_request_list_error || projects_error) {
//         console.log("Error in approve-pr.tsx", procurement_request_list_error?.message, projects_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
//             variant: "destructive"
//         })
//     }
//     return (
//         <div className="flex-1 md:space-y-4">
//             {projects_loading || procurement_request_list_loading ? (<TableSkeleton />)
//                 :
//                 (<DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />)}
//         </div>
//     )
// }

// export default ApprovePR;




import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
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
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ProcurementRequest, ProcurementItem, Category } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "./hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";

// --- Constants ---
const DOCTYPE = 'Procurement Requests';
const URL_SYNC_KEY = 'pr_new_approve'; // Unique key for this specific table instance/view

// --- Component ---
export const ApprovePR: React.FC = () => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    
    const projectsFetchOptions = getProjectListOptions();
    
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList(); // For owner display
    const { notifications, mark_seen_notification } = useNotificationStore();

    // --- Memoized Options ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);

    // --- Notification Handling ---
    const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);

    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["workflow_state", "=", "Pending"] // Filter specifically for "Pending" state PRs
    ], []);

    // --- Fields to Fetch ---
    const fieldsToFetch: (keyof ProcurementRequest | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "work_package", "procurement_list", // Needed for ItemsHoverCard
        "category_list", "workflow_state"
    ], []);

    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "work_package", "owner"
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
                    (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:new" // Assuming this event ID for new PRs
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && ( <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" /> )}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/procurement-requests/${prId}?tab=Approve PR`} >
                            {prId?.slice(-4)}
                        </Link>
                        {!data.work_package && <Badge className="text-xs">Custom</Badge>}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                           <ItemsHoverCard order_list={Array.isArray(data.procurement_list?.list) ? data.procurement_list.list : []} isPR />
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
                const project = projectOptions.find(i => i.value === row.original.project);
                return <div className="font-medium truncate" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 200,
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
        // Removed Estimated Price column as per original component's commented-out code
    ], [notifications, projectOptions, userList, handleNewPRSeen]); // Removed getTotal dependency


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
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
        globalSearchFieldList: globalSearchFields,
        enableItemSearch: true, // Enable item search for PRs (searches procurement_list)
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // Enable for bulk actions
        additionalFilters: staticFilters, // Filter by workflow_state = Pending
        // requirePendingItems: false // Not needed here as the base filter is already 'Pending' state
    });

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event received for ${DOCTYPE} (ApprovePR View):`, event);
        // Refetch if a PR is created or updated (could refine based on workflow state if needed)
        refetch();
        toast({ title: "Procurement Requests list updated.", duration: 2000 });
    });


    // --- Combined Loading State & Error Handling ---
    const isLoading = projectsLoading || userListLoading;
    const error = projectsError || userError || listError;

    if (error) {
        toast({ title: "Error loading data", description: error.message, variant: "destructive" });
    }

    return (
        <div className="flex-1 md:space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProcurementRequest>
                    table={table}
                    columns={columns}
                    // data={data} // Data managed internally by table instance
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search Pending PRs..." // Updated placeholder
                    showItemSearchToggle={showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    // showExport={true} // Enable if needed
                    // toolbarActions={<Button size="sm">Bulk Approve/Reject...</Button>} // Placeholder
                />
            )}
        </div>
    );
}

export default ApprovePR;