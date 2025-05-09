// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
// import { useUserData } from "@/hooks/useUserData";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
// import { UserContext } from "@/utils/auth/UserProvider";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
// import { parseNumber } from "@/utils/parseNumber";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { FrappeConfig, FrappeContext, useFrappeGetDocList } from "frappe-react-sdk";
// import memoize from 'lodash/memoize';
// import { Trash2 } from "lucide-react";
// import { useCallback, useContext, useMemo, useState } from "react";
// import { TailSpin } from "react-loader-spinner";
// import { Link, useSearchParams } from "react-router-dom";
// import { ItemsHoverCard } from "../helpers/ItemsHoverCard";
// import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
// import { Button } from "../ui/button";
// import { TableSkeleton } from "../ui/skeleton";
// import { useToast } from "../ui/use-toast";

// export const SentBackRequest : React.FC<{tab? : string}> = ({tab}) => {

//     const [searchParams] = useSearchParams();

//     const {role} = useUserData()

//     const type = useMemo(() => tab || (searchParams.get("tab") || "Rejected"), [tab, searchParams.get("tab")])

//     const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error, mutate : sent_back_list_mutate } = useFrappeGetDocList<SentBackCategory>("Sent Back Category",
//         {
//             fields: ['name', 'item_list', 'workflow_state', 'procurement_request', 'project', 'creation', 'type', 'modified'],
//             filters: [["workflow_state", "=", "Pending"], ["type", "=", type]],
//             limit: 10000,
//             orderBy: { field: "modified", order: "desc" }
//         },
//         type ? `${type} Sent Back Category` : null
//     );

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     },
//     `Projects`
//     )

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects]);

//     const getTotal = useMemo(() => memoize((order_id: string) => {
//         let total: number = 0;
//         const orderData = sent_back_list?.find(item => item.name === order_id)?.item_list;
//         orderData?.list.map((item) => {
//             const price = parseNumber(item.quote);
//             total += parseNumber(price * item.quantity);
//         })
//         return total;
//     }, (order_id: string) => order_id), [sent_back_list]);

//     // const { role, user_id } = useUserData()

//     // const { newSBCounts, adminNewSBCounts } = useDocCountStore()

//     const { mark_seen_notification, notifications } = useNotificationStore()

//     const { db } = useContext(FrappeContext) as FrappeConfig
//     const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
//         if (notification) {
//             mark_seen_notification(db, notification)
//         }
//     }, [db, mark_seen_notification])

//     const [deleteFlagged, setDeleteFlagged] = useState<SentBackCategory | null>(null);

//     const {deleteDialog, toggleDeleteDialog} = useContext(UserContext);

//     const {handleDeleteSB, deleteLoading} = usePRorSBDelete(sent_back_list_mutate);
        
//     // const updateURL = (key, value) => {
//     //     const url = new URL(window.location);
//     //     url.searchParams.set(key, value);
//     //     window.history.pushState({}, "", url);
//     // };


//     // const onClick = (value) => {

//     //     if (type === value) return; // Prevent redundant updates

//     //     const newTab = value;
//     //     setType(newTab);
//     //     updateURL("type", newTab);

//     // };

//     // const items = [
//     //     {
//     //         label: (
//     //             <div className="flex items-center">
//     //                 <span>Rejected</span>
//     //                 <span className="ml-2 text-xs font-bold">
//     //                     {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.rejected : newSBCounts.rejected}
//     //                 </span>
//     //             </div>
//     //         ),
//     //         value: "Rejected",
//     //     },
//     //     {
//     //         label: (
//     //             <div className="flex items-center">
//     //                 <span>Delayed</span>
//     //                 <span className="ml-2 rounded text-xs font-bold">
//     //                     {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.delayed : newSBCounts.delayed}
//     //                 </span>
//     //             </div>
//     //         ),
//     //         value: "Delayed",
//     //     },
//     //     {
//     //         label: (
//     //             <div className="flex items-center">
//     //                 <span>Cancelled</span>
//     //                 <span className="ml-2 rounded text-xs font-bold">
//     //                     {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.cancelled : newSBCounts.cancelled}
//     //                 </span>
//     //             </div>
//     //         ),
//     //         value: "Cancelled",
//     //     },
//     // ];

//     const columns: ColumnDef<SentBackCategory>[] = useMemo(
//         () => [
//             {
//                 accessorKey: "name",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Sentback ID" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const data = row.original
//                     const sbId = data?.name
//                     const isNew = notifications.find(
//                         (item) => item.docname === sbId && item.seen === "false" && item.event_id === `${type}-sb:new`
//                     )
//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex items-center gap-2">
//                             <Link
//                                 className="underline hover:underline-offset-2"
//                                 to={`/sent-back-requests/${sbId}`}
//                             >
//                                 {sbId?.slice(-4)}
//                             </Link>
//                             <ItemsHoverCard order_list={data?.item_list?.list} isSB />
//                             </div>
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "procurement_request",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="#PR" />
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
//                 accessorKey: "total",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Amount" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     const id = row.getValue("name")
//                     return (
//                         <div className="font-medium">
//                             {getTotal(id) === 0 ? "N/A" : formatToRoundedIndianRupee(getTotal(id))}
//                         </div>
//                     )
//                 }
//             },
//             ...(["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role) ? [
//                             {
//                                 id: "deleteOption",
//                                 cell: ({row}) => {
//                                     return (
//                                         <Trash2 className="text-primary cursor-pointer" onClick={() => {
//                                             setDeleteFlagged(row.original)
//                                             toggleDeleteDialog()
//                                         }} />
//                                     )
//                                 }
//                             }
//                         ] : []),
//         ],
//         [project_values, sent_back_list, notifications, tab, type]
//     )

//     const { toast } = useToast()

//     if (sent_back_list_error || projects_error) {
//         console.log("Error in sent-back-request.tsx", sent_back_list_error?.message, projects_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${sent_back_list_error?.message || projects_error?.message}`,
//             variant: "destructive"
//         })
//     }

//     return (
//         <div className="flex-1 space-y-4">
//             {(sent_back_list_loading || projects_loading) ? (<TableSkeleton />) : (
//                 <DataTable columns={columns} data={sent_back_list || []} project_values={project_values} />
//             )}
//                     <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
//                             <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
//                                 <AlertDialogHeader className="text-start">
//                                     <AlertDialogTitle className="text-center">
//                                         Delete Sent Back PR
//                                     </AlertDialogTitle>
//                                         <AlertDialogDescription>Are you sure you want to delete this PR : {deleteFlagged?.name}?</AlertDialogDescription>
//                                     <div className="flex gap-2 items-center pt-4 justify-center">
//                                         {deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
//                                             <>
//                                                 <AlertDialogCancel className="flex-1" asChild>
//                                                     <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
//                                                 </AlertDialogCancel>
//                                                  <Button
//                                                     onClick={() => handleDeleteSB(deleteFlagged?.name || "")}
//                                                     className="flex-1">
//                                                         Confirm
//                                                 </Button>
//                                             </>
//                                         )}
//                                     </div>
            
//                                 </AlertDialogHeader>
//                             </AlertDialogContent>
//                         </AlertDialog>
//         </div>
//     )
// }

// export default SentBackRequest;



import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom"; // useSearchParams not needed here if tab is passed as prop
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Checkbox } from "@/components/ui/checkbox";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"; // Ensure correct path
import { Button } from "@/components/ui/button"; // Ensure correct path
import { TailSpin } from "react-loader-spinner";


// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";

// --- Types ---
import { SentBackCategory, SentBackItem } from "@/types/NirmaanStack/SentBackCategory";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "../helpers/ItemsHoverCard"; // Adjust path if necessary
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useUrlParam } from "@/hooks/useUrlParam";

// --- Constants ---
const DOCTYPE = 'Sent Back Category';
// URL_SYNC_KEY will be dynamic based on the tab/type prop

interface SentBackRequestProps {
    tab: string; // e.g., "Rejected", "Delayed", "Cancelled"
}

// --- Component ---
export const SentBackRequest = () => {
    const { role } = useUserData();
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    const tab = useUrlParam("tab");

    // Determine type from tab prop
    // const type = useMemo(() => tab, [tab]);
    const urlSyncKey = useMemo(() => `sb_${tab?.toLowerCase().replace(/\s+/g, '_')}`, [tab]);

    const projectsFetchOptions = getProjectListOptions();
    
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();
    const { notifications, mark_seen_notification } = useNotificationStore();


    // --- Memoized Calculations & Options ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);

    const getTotal = useMemo(() => memoize((itemList: { list: SentBackItem[] } | undefined | null): number => {
        let total = 0;
        const items = Array.isArray(itemList?.list) ? itemList.list : [];
        items.forEach((item) => {
            total += parseNumber((item.quote || 0) * item.quantity);
        });
        return total;
    }), []);


    // --- Notification Handling ---
    const handleNewSBSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);


    // --- Dialog State for Delete ---
    const [deleteDialog, setDeleteDialog] = useState(false);
    const toggleDeleteDialog = () => setDeleteDialog(prev => !prev);
    const [deleteFlagged, setDeleteFlagged] = useState<SentBackCategory | null>(null);
    // We'll need to pass the `refetch` function to `usePRorSBDelete` or handle refetch here
    // const { handleDeleteSB, deleteLoading } = usePRorSBDelete();


    // --- Static Filters for this View (based on type/tab) ---
    const staticFilters = useMemo(() => [
        ["workflow_state", "=", "Pending"], // Common filter for sent back items needing action
        ["type", "=", tab]                 // Filter by the specific sent back type
    ], [tab]);


    // --- Fields to Fetch ---
    const fieldsToFetch: (keyof SentBackCategory | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "procurement_request", "item_list", "workflow_state", "type"
    ], []);


    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "procurement_request", "owner", "type"
    ], []);


    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => ["creation", "modified"], []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<SentBackCategory>[]>(() => [
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
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="SB ID" />,
            cell: ({ row }) => {
                const data = row.original;
                const sbId = data.name;
                const eventIdForNotif = `${tab?.toLowerCase().replace(/\s+/g, '_')}-sb:new`; // e.g., rejected-sb:new
                const isNew = notifications.find(
                    n => n.docname === sbId && n.seen === "false" && n.event_id === eventIdForNotif
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSBSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/sent-back-requests/${sbId.replaceAll("/", "&=")}?tab=${tab}`} >
                            {sbId?.slice(-5)}
                        </Link>
                        {/* {data.type && <Badge variant="secondary" className="text-xs">{data.type}</Badge>} */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                           <ItemsHoverCard order_list={Array.isArray(data.item_list?.list) ? data.item_list.list : []} isSB />
                        </div>
                    </div>
                );
            }, size: 180,
        },
        {
            accessorKey: "procurement_request", header: ({ column }) => <DataTableColumnHeader column={column} title="#PR" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("procurement_request")?.slice(-4) ?? '--'}</div>,
            size: 100,
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
                return <div className="font-medium truncate" title={project?.label}>{project?.label || row.original.project}</div>;
            },
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
            id: "sent_back_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Estd. Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotal(row.original.item_list))}</p>),
            size: 150, enableSorting: false,
        },
        ...((["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role)) ? [{ // Assuming Admins/Leads can delete sent-back items
            id: "actions", header: "Actions",
            cell: ({row}) => (
                <Button variant="ghost" size="sm" onClick={() => { setDeleteFlagged(row.original); toggleDeleteDialog(); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            ), size: 80,
        } as ColumnDef<SentBackCategory>] : []),
    ], [tab, notifications, projectOptions, userList, handleNewSBSeen, getTotal, role]);


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        // type: { title: "Type", options: [{label: "Rejected", value:"Rejected"}, ...]} // If type needs to be a facet
    }), [projectOptions]);

    // --- useServerDataTable Hook Instantiation ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        globalFilter, setGlobalFilter,
        isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
        refetch,
    } = useServerDataTable<SentBackCategory>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        globalSearchFieldList: globalSearchFields,
        enableItemSearch: true, // Enable item search within item_list
        urlSyncKey: urlSyncKey, // Dynamic URL key based on tab/type
        defaultSort: 'modified desc',
        enableRowSelection: false, // For delete action
        additionalFilters: staticFilters,
        requirePendingItems: true, // This is crucial and should be handled correctly
    });

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} in SentBackRequest (tab: ${tab}):`, event);
        // Potentially filter event based on event.doc.type === type before refetching
        if (event.doc && event.doc.type === tab) {
            refetch();
            toast({ title: `Sent Back list (${tab}) updated.`, duration: 2000 });
        } else if (!event.doc?.type) { // Generic update, refetch
            refetch();
            toast({ title: `Sent Back list updated.`, duration: 2000 });
        }
    });

     // --- Delete Handler ---
    const { handleDeleteSB, deleteLoading } = usePRorSBDelete(refetch); // Pass refetch to the delete hook

    const handleConfirmDelete = async () => {
        if (deleteFlagged) {
            await handleDeleteSB(deleteFlagged.name);
            setDeleteFlagged(null);
            toggleDeleteDialog();
            // Refetch is handled by the hook now
        }
    };

    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || userListLoading;
    const combinedError = projectsError || userError || listError; // Changed variable name

    if (combinedError) { // Changed variable name
        toast({ title: "Error loading data", description: combinedError.message, variant: "destructive" });
    }

    return (
        <div className="flex-1 md:space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<SentBackCategory>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder={`Search ${tab} Items...`}
                    showItemSearchToggle={showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                />
            )}
            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Sent Back Item</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete item: {deleteFlagged?.name}? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex gap-2 items-center pt-4 justify-end">
                        {deleteLoading ? <TailSpin color="red" width={24} height={24} /> : (
                            <>
                                <AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel>
                                <Button variant="destructive" onClick={handleConfirmDelete}>Confirm Delete</Button>
                            </>
                        )}
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default SentBackRequest;