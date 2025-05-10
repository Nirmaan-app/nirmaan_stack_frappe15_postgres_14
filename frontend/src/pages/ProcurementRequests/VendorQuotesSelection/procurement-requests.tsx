// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { toast } from "@/components/ui/use-toast";
// import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
// import { useUserData } from "@/hooks/useUserData";
// import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { UserContext } from "@/utils/auth/UserProvider";
// import { formatDate } from "@/utils/FormatDate";
// import { useDocCountStore } from "@/zustand/useDocCountStore";
// import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
// import { ColumnDef } from "@tanstack/react-table";
// import { Radio } from "antd";
// import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
// import { Trash2 } from "lucide-react";
// import React, { Suspense, useCallback, useContext, useMemo, useState } from "react";
// import { TailSpin } from "react-loader-spinner";
// import { Link, useSearchParams } from "react-router-dom";
// import { TableSkeleton } from "../../../components/ui/skeleton";

// const ApprovePR = React.lazy(() => import("../ApproveNewPR/approve-pr"));

// const SentBackRequest = React.lazy(() => import("@/components/procurement/sent-back-request"));

// export const ProcurementRequests : React.FC = () => {

//     const [searchParams] = useSearchParams();
//     const { role } = useUserData()

//     const [tab, setTab] = useState<string>(searchParams.get("tab") || (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? "Approve PR" : "New PR Request"));

//     const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: prListMutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
//         {
//             fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', "category_list", 'creation', 'modified'],
//             filters: [["workflow_state", "=", tab === "New PR Request" ? "Approved" : "In Progress"]],
//             limit: 10000,
//             orderBy: { field: "modified", order: "desc" }
//         }
//     );

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     },
//     `Projects`
//     )

//     // const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
//     //     {
//     //         fields: ["*"],
//     //         limit: 100000
//     //     },
//     //     `Approved Quotations`
//     // );

//     useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
//         await prListMutate()
//     })

//     // const getTotal = useMemo(() => memoize((order_id: string) => {
//     //     console.log("running getTotal for", order_id)
//     //     let total: number = 0;
//     //     let usedQuotes = {}
//     //     const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
//     //     // console.log("orderData", orderData)
//     //     orderData?.list.map((item) => {
//     //         const minQuote = getThreeMonthsLowestFiltered(quote_data, item.name)
//     //         if (minQuote) {
//     //             const estimateQuotes = quote_data
//     //                 ?.filter(value => value.item_id === item.name && parseNumber(value.quote) === minQuote)?.sort((a, b) => new Date(b.modified) - new Date(a.modified)) || [];
//     //             const latestQuote = estimateQuotes.length ? estimateQuotes[0] : null;
//     //             usedQuotes = { ...usedQuotes, [item.item]: { items: latestQuote, amount: minQuote, quantity: item.quantity }}
//     //         }
//     //         total += minQuote * item.quantity;
//     //     })
//     //     return { total: total || "N/A", usedQuotes: usedQuotes }
//     // }, (order_id: string) => order_id),[quote_data, procurement_request_list])

//     const { notifications, mark_seen_notification } = useNotificationStore()

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

//     const { db } = useContext(FrappeContext) as FrappeConfig

//     const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
//         if (notification) {
//             mark_seen_notification(db, notification)
//         }
//     }, [db, mark_seen_notification]);

//     const updateURL = useCallback((key : string, value : string) => {
//         const url = new URL(window.location.href);
//         url.searchParams.set(key, value);
//         window.history.pushState({}, "", url);
//     }, []);

//     const onClick = useCallback((value : string) => {
//         if (tab === value) return;
//         setTab(value);
//         updateURL("tab", value);
//     }, [tab, updateURL]);

//     const {deleteDialog, toggleDeleteDialog} = useContext(UserContext);

//     const {handleDeletePR, deleteLoading} = usePRorSBDelete(prListMutate);

//     const [deleteFlagged, setDeleteFlagged] = useState<ProcurementRequest | null>(null);

//     const { prCounts, adminPrCounts, newSBCounts, adminNewSBCounts } = useDocCountStore()

//     const sentBackTabs = useMemo(() => [
//         ...(["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
//                 {
//                     label: (
//                         <div className="flex items-center">
//                             <span>Sent Back</span>
//                             <span className="ml-2 text-xs font-bold">
//                                 {(role === "Nirmaan Admin Profile") ? adminNewSBCounts.rejected : newSBCounts.rejected}
//                             </span>
//                         </div>
//                     ),
//                     value: "Rejected",
//                 },
//                 {
//                     label: (
//                         <div className="flex items-center">
//                             <span>Skipped PR</span>
//                             <span className="ml-2 rounded text-xs font-bold">
//                                 {(role === "Nirmaan Admin Profile") ? adminNewSBCounts.delayed : newSBCounts.delayed}
//                             </span>
//                         </div>
//                     ),
//                     value: "Delayed",
//                 },
//                 {
//                     label: (
//                         <div className="flex items-center">
//                             <span>Rejected PO</span>
//                             <span className="ml-2 rounded text-xs font-bold">
//                                 {(role === "Nirmaan Admin Profile") ? adminNewSBCounts.cancelled : newSBCounts.cancelled}
//                             </span>
//                         </div>
//                     ),
//                     value: "Cancelled",
//                 },
//             ] : [])
//     ], [role, newSBCounts, adminNewSBCounts])

//     const adminTabs = useMemo(() => [
//         ...(["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
//             {
//                 label: (
//                     <div className="flex items-center">
//                         <span>Approve PR</span>
//                         <span className="ml-2 text-xs font-bold">
//                             {(role === "Nirmaan Admin Profile") ? adminPrCounts.pending : prCounts.pending}
//                         </span>
//                     </div>
//                 ),
//                 value: "Approve PR",
//             },
//         ] : []),
//     ], [role, prCounts, adminPrCounts])

//     const items = useMemo(() => [
//         ...(["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile",  "Nirmaan Project Lead Profile"].includes(role) ? [
//         {
//             label: (
//                 <div className="flex items-center">
//                     <span>New PR Request</span>
//                     <span className="ml-2 text-xs font-bold">
//                         {(role === "Nirmaan Admin Profile") ? adminPrCounts.approved : prCounts.approved}
//                     </span>
//                 </div>
//             ),
//             value: "New PR Request",
//         },
//         {
//             label: (
//                 <div className="flex items-center">
//                     <span>In Progress</span>
//                     <span className="ml-2 text-xs font-bold">
//                         {(role === "Nirmaan Admin Profile") ? adminPrCounts.inProgress : prCounts.inProgress}
//                     </span>
//                 </div>
//             ),
//             value: "In Progress",
//         },
//     ] : []),
//     ], [role, adminPrCounts, prCounts])

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
//                         (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:approved"
//                     )
//                     return (
//                         <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
//                             {isNew && (
//                                 <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
//                             )}
//                             <div className="flex items-center gap-2">
//                                 <Link
//                                     className="underline hover:underline-offset-2"
//                                     to={`${prId}?tab=${tab}`}
//                                 >
//                                     {prId?.slice(-4)}
//                                 </Link>
//                                 <ItemsHoverCard order_list={data?.procurement_list?.list} isPR/>
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
//                     return (
//                         <div className="flex flex-col gap-1 items-start justify-center">
//                             {row.getValue("category_list")?.list?.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
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
//             // },
//             ...((tab === "New PR Request"  && ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role)) ? [
//                 {
//                     id: "deleteOption",
//                     cell: ({row}) => {
//                         return (
//                             <Trash2 className="text-primary cursor-pointer" onClick={() => {
//                                 setDeleteFlagged(row.original)
//                                 toggleDeleteDialog()
//                             }} />
//                         )
//                     }
//                 }
//             ] : []),
//         ],
//         [project_values, procurement_request_list, tab, notifications]
//     )

//     if (procurement_request_list_error || projects_error) {
//         console.log("Error in Procurement-approved.tsx", procurement_request_list_error?.message, projects_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
//             variant: "destructive"
//         })
//     }

//     return (
//         <>
//         <div className="flex-1 space-y-4">
//             <div className="flex items-center max-md:items-start gap-4 max-md:flex-col"> 
//             {adminTabs && (
//                     <Radio.Group
//                         options={adminTabs}
//                         optionType="button"
//                         buttonStyle="solid"
//                         value={tab}
//                         onChange={(e) => onClick(e.target.value)}
//                     />
//                 )}

//                 {items && (
//                     <Radio.Group
//                         options={items}
//                         optionType="button"
//                         buttonStyle="solid"
//                         value={tab}
//                         onChange={(e) => onClick(e.target.value)}
//                     />
//                 )}

//                 {sentBackTabs && (
//                     <Radio.Group
//                         options={sentBackTabs}
//                         optionType="button"
//                         buttonStyle="solid"
//                         value={tab}
//                         onChange={(e) => onClick(e.target.value)}
//                     />
//                 )}
//             </div>

//             <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
//                 <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
//                     <AlertDialogHeader className="text-start">
//                         <AlertDialogTitle className="text-center">
//                             Delete Procurement Request
//                         </AlertDialogTitle>
//                             <AlertDialogDescription>Are you sure you want to delete this PR : {deleteFlagged?.name}?</AlertDialogDescription>
//                         <div className="flex gap-2 items-center pt-4 justify-center">
//                             {deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
//                                 <>
//                                     <AlertDialogCancel className="flex-1" asChild>
//                                         <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
//                                     </AlertDialogCancel>
//                                      <Button
//                                         onClick={() => handleDeletePR(deleteFlagged?.name || "")}
//                                         className="flex-1">
//                                             Confirm
//                                     </Button>
//                                 </>
//                             )}
//                         </div>

//                     </AlertDialogHeader>
//                 </AlertDialogContent>
//             </AlertDialog>

//                 <Suspense fallback={
//                     <div className="flex items-center h-[90vh] w-full justify-center">
//                         <TailSpin color={"red"} />{" "}
//                     </div>
//                 }>
//                     {
//                         tab === "Approve PR" ? (
//                             <ApprovePR />
//                         ) :
//                         ["Rejected", "Delayed", "Cancelled"].includes(tab) ? (
//                             <SentBackRequest tab={tab} />
//                         ) :
//                         (
//                             (projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
//                                 <DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />
//                             )
//                         )
//                     }
//                 </Suspense>
                            
//             {/* {tab === "Approve PR" ? (
//                 <Suspense fallback={
//                     <div className="flex items-center h-[90vh] w-full justify-center">
//                         <TailSpin color={"red"} />{" "}
//                     </div>
//                 }>
//                     <ApprovePR />
//                 </Suspense>
//             ) :
//             ["Rejected", "Delayed", "Cancelled"].includes(tab) ? (
//                 <Suspense fallback={
//                     <div className="flex items-center h-[90vh] w-full justify-center">
//                         <TailSpin color={"red"} />{" "}
//                     </div>
//                 }>
//                     <SentBackRequest />
//                 </Suspense>
//             ) :
//              (
//                 (projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
//                     <DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />
//                 )
//             )} */}
//             </div>
//         </>
//     )
// }


import React, { Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Radio } from "antd";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TableSkeleton } from "@/components/ui/skeleton";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TailSpin } from "react-loader-spinner";


// --- Hooks & Utils ---
import { useServerDataTable, getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from "@/utils/urlStateManager";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";

// --- Types ---
import { ProcurementRequest, ProcurementItem, Category } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "../ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";

// --- Lazy Loaded Tab Components ---
const ApprovePR = React.lazy(() => import("../ApproveNewPR/approve-pr"));
const SentBackRequest = React.lazy(() => import("@/components/procurement/sent-back-request"));

// --- Constants ---
const DOCTYPE = 'Procurement Requests';
const URL_SYNC_KEY_BASE = 'pr'; // Base key for URL params for this page

// --- Component ---
export const ProcurementRequests: React.FC = () => {
    const { role } = useUserData();
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- Tab State Management using urlStateManager ---
    const initialTab = useMemo(() => {
        const adminDefault = "Approve PR";
        const userDefault = "New PR Request";
        return getUrlStringParam("tab", ["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? adminDefault : userDefault);
    }, [role]);

    const [tab, setTab] = useState<string>(initialTab);

    useEffect(() => { // Sync tab state TO URL
        if (urlStateManager.getParam("tab") !== tab) {
            urlStateManager.updateParam("tab", tab);
        }
    }, [tab]);

    useEffect(() => { // Sync URL TO tab state
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            const newTab = value || initialTab;
            if (tab !== newTab) setTab(newTab);
        });
        return unsubscribe;
    }, [tab, initialTab]);


    const projectsFetchOptions = getProjectListOptions();
        
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList(); // For owner display
    const { notifications, mark_seen_notification } = useNotificationStore();

    // --- Dialog State for Delete ---
    const [deleteDialog, setDeleteDialog] = useState(false); // Replaced UserContext for local state
    const toggleDeleteDialog = () => setDeleteDialog(prev => !prev);
    const [deleteFlagged, setDeleteFlagged] = useState<ProcurementRequest | null>(null);
    const { handleDeletePR, deleteLoading } = usePRorSBDelete(); // Pass mutate if needed


    // --- Memoized Options and Counts ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);
    const { prCounts, adminPrCounts, newSBCounts, adminNewSBCounts } = useDocCountStore();

    // --- Tab Definitions ---
    const adminTabs = useMemo(() => (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
        { label: (<div className="flex items-center"><span>Approve PR</span><span className="ml-2 text-xs font-bold">{(role === "Nirmaan Admin Profile") ? adminPrCounts.pending : prCounts.pending}</span></div>), value: "Approve PR" },
    ] : []), [role, prCounts, adminPrCounts]);

    const userPRExecTabs = useMemo(() => (["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
        { label: (<div className="flex items-center"><span>New PR Request</span><span className="ml-2 text-xs font-bold">{(role === "Nirmaan Admin Profile") ? adminPrCounts.approved : prCounts.approved}</span></div>), value: "New PR Request" },
        { label: (<div className="flex items-center"><span>In Progress</span><span className="ml-2 text-xs font-bold">{(role === "Nirmaan Admin Profile") ? adminPrCounts.inProgress : prCounts.inProgress}</span></div>), value: "In Progress" },
    ] : []), [role, adminPrCounts, prCounts]);

    const sentBackTabsConfig = useMemo(() => (["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
        { label: (<div className="flex items-center"><span>Sent Back</span><span className="ml-2 text-xs font-bold">{(role === "Nirmaan Admin Profile") ? adminNewSBCounts.rejected : newSBCounts.rejected}</span></div>), value: "Rejected" },
        { label: (<div className="flex items-center"><span>Skipped PR</span><span className="ml-2 rounded text-xs font-bold">{(role === "Nirmaan Admin Profile") ? adminNewSBCounts.delayed : newSBCounts.delayed}</span></div>), value: "Delayed" },
        { label: (<div className="flex items-center"><span>Rejected PO</span><span className="ml-2 rounded text-xs font-bold">{(role === "Nirmaan Admin Profile") ? adminNewSBCounts.cancelled : newSBCounts.cancelled}</span></div>), value: "Cancelled" },
    ] : []), [role, newSBCounts, adminNewSBCounts]);


    // --- Notification Handling ---
    const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);


    // --- Static Filters for Data Table based on Tab ---
    const staticFiltersForDataTable = useMemo(() => {
        switch (tab) {
            case "New PR Request": return [["workflow_state", "=", "Approved"]]; // For PR Exec to see newly approved PRs
            case "In Progress": return [["workflow_state", "=", "In Progress"]]; // PRs being worked on
            default: return []; // No static filters if tab renders a different component
        }
    }, [tab]);

    // --- Fields to Fetch for Data Table ---
    const fieldsToFetch: (keyof ProcurementRequest | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "work_package", "procurement_list", "category_list", "workflow_state",
    ], []);

    // --- Global Search Fields for Data Table ---
    const globalSearchFieldsForDataTable = useMemo(() => [
        "name", "project", "work_package", "owner",
        // Note: "project" is a Link field, search on project_name instead for user-friendliness
    ], []);

    // --- Date Filter Columns ---
    const dateColumnsForDataTable = useMemo(() => ["creation", "modified"], []);

    // --- Column Definitions for Data Table ---
    const dataTableColumns = useMemo<ColumnDef<ProcurementRequest>[]>(() => [
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
                const data = row.original; const prId = data.name;
                // Determine event_id based on tab if notifications differ
                const eventIdForNotif = tab === "New PR Request" ? "pr:approved" : (tab === "In Progress" ? "pr:rfqGenerated" : "pr:general"); // Example
                const isNew = notifications.find(n => n.docname === prId && n.seen === "false" && n.event_id === eventIdForNotif);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/procurement-requests/${prId}?tab=${tab}`}>
                            {prId?.slice(-4)}
                        </Link>
                        {!data.work_package && <Badge className="text-xs">Custom</Badge>}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                           <ItemsHoverCard order_list={Array.isArray(data.procurement_list?.list) ? data.procurement_list.list : []} isPR />
                        </div>
                    </div>
                );
            }, size: 170,
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
                        {categoryItems.length > 0 ? categoryItems.map((cat) => <Badge key={cat.name} variant="outline" className="text-xs">{cat.name}</Badge>) : '--'}
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
        // Conditional Delete Column
        ...((tab === "New PR Request" && ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role)) ? [{
            id: "actions", header: "Actions",
            cell: ({row}) => (
                <Button variant="ghost" size="sm" onClick={() => { setDeleteFlagged(row.original); toggleDeleteDialog(); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            ), size: 80,
        } as ColumnDef<ProcurementRequest>] : []),
    ], [tab, role, notifications, projectOptions, userList, handleNewPRSeen]); // Dependencies for columns


    // --- Faceted Filter Options for Data Table ---
    const facetFilterOptionsForDataTable = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
    }), [projectOptions]);


    // --- useServerDataTable Hook Instantiation for Data Table Tabs ---
    const shouldRenderDataTable = useMemo(() =>
        ["New PR Request", "In Progress"].includes(tab),
    [tab]);

    const serverDataTable = useServerDataTable<ProcurementRequest>(
        shouldRenderDataTable ? {
            doctype: DOCTYPE,
            columns: dataTableColumns,
            fetchFields: fieldsToFetch,
            globalSearchFieldList: globalSearchFieldsForDataTable,
            enableItemSearch: true, // Enable item search within procurement_list
            urlSyncKey: `${URL_SYNC_KEY_BASE}_${tab.toLowerCase().replace(/\s+/g, '_')}`, // Unique key per tab for data table state
            defaultSort: 'modified desc',
            enableRowSelection: false, // Enable selection for delete
            additionalFilters: staticFiltersForDataTable,
        } : { // Minimal config for non-table tabs to satisfy hook types
            doctype: DOCTYPE, columns: [], fetchFields: ["name"], globalSearchFieldList: ["name"]
        }
    );

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => { // Correct hook usage
        console.log(`Realtime event received for ${DOCTYPE} (Main View):`, event);
        if (shouldRenderDataTable) {
             serverDataTable.refetch();
        }
        // Optionally, trigger mutate for other components if they are visible and use useFrappeGetDocList
        // e.g. if ApprovePR or SentBackRequest are visible and use their own useFrappeGetDocList
        if (tab === "Approve PR" /* && ApprovePR is visible */) {
             // Need a way to trigger mutate for ApprovePR if it's using useFrappeGetDocList
             // This part might require ApprovePR to also use `refetch` from useServerDataTable
             // or a global event bus / Zustand action.
        }
        toast({ title: `${DOCTYPE} list updated.`, duration: 2000 });
    });


    // --- Combined Loading & Error States ---
    const isSupportingDataLoading = projectsLoading || userListLoading;
    const supportingDataError = projectsError || userError;

    const handleConfirmDelete = async () => {
        if (deleteFlagged) {
            await handleDeletePR(deleteFlagged.name); // handleDeletePR should handle toast/mutate
            setDeleteFlagged(null); // Clear after action
            toggleDeleteDialog(); // Close dialog
             if (shouldRenderDataTable) serverDataTable.refetch(); // Refetch table data
        }
    };

    // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
            // The useEffect for tab will update the URL
        }
    }, [tab]);


    // --- Render Logic ---
    const renderCurrentTab = () => {
        if (tab === "Approve PR") return <ApprovePR />; // ApprovePR now uses its own useServerDataTable
        if (["Rejected", "Delayed", "Cancelled"].includes(tab)) return <SentBackRequest />; // SentBackRequest might need similar refactor

        if (shouldRenderDataTable) {
            if (isSupportingDataLoading) return <TableSkeleton />;
            if (supportingDataError) return <div className="text-red-500 p-4">Error loading supporting data: {supportingDataError.message}</div>;

            return (
                <DataTable<ProcurementRequest>
                    table={serverDataTable.table}
                    columns={dataTableColumns}
                    isLoading={serverDataTable.isLoading}
                    error={serverDataTable.error}
                    totalCount={serverDataTable.totalCount}
                    globalFilterValue={serverDataTable.globalFilter}
                    onGlobalFilterChange={serverDataTable.setGlobalFilter}
                    searchPlaceholder={`Search ${tab}...`}
                    showItemSearchToggle={serverDataTable.showItemSearchToggle}
                    itemSearchConfig={{
                        isEnabled: serverDataTable.isItemSearchEnabled,
                        toggle: serverDataTable.toggleItemSearch,
                        label: "Item Search"
                    }}
                    facetFilterOptions={facetFilterOptionsForDataTable}
                    dateFilterColumns={dateColumnsForDataTable}
                    showExport={false}
                    onExport={() => console.log("exported")}
                    // toolbarActions={...} // Add if needed
                />
            );
        }
        return <div>Select a tab to view requests.</div>; // Fallback
    };

    return (
        <>
            <div className="flex-1 space-y-4">
                <div className="flex items-center max-md:items-start gap-4 max-md:flex-col">
                    <Radio.Group options={adminTabs} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
                    <Radio.Group options={userPRExecTabs} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
                    <Radio.Group options={sentBackTabsConfig} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
                </div>

                <Suspense fallback={<LoadingFallback />}>
                    {renderCurrentTab()}
                </Suspense>
            </div>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Procurement Request</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete PR: {deleteFlagged?.name}? This action cannot be undone.
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
        </>
    );
};

export default ProcurementRequests;