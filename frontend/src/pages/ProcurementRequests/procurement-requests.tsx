import React, { Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Radio } from "antd";
import { Trash2 } from "lucide-react";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
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
import { ProcurementRequest, Category } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "./ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { DEFAULT_PR_FIELDS_TO_FETCH, getPRStaticFilters, PR_DATE_COLUMNS, PR_SEARCHABLE_FIELDS } from "./config/prTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Lazy Loaded Tab Components ---
const ApprovePR = React.lazy(() => import("./ApproveNewPR/approve-pr"));
const SentBackRequest = React.lazy(() => import("@/pages/Sent Back Requests/sent-back-request"));

// --- Constants ---
const DOCTYPE = 'Procurement Requests';
const URL_SYNC_KEY_BASE = 'pr'; // Base key for URL params for this page


const PRDataTableWrapper: React.FC<{
    tab: string;
    columns: any;
    fieldsToFetch: string[];
    prSearchableFields: SearchFieldOption[];
    staticFilters: any[];
    facetFilterOptions: any;
    dateColumns: any;
    notifications: NotificationType[];
}> = ({
    tab,
    columns,
    fieldsToFetch,
    prSearchableFields,
    staticFilters,
    facetFilterOptions,
    dateColumns,
    notifications
}) => {
        // Generate urlSyncKey inside the wrapper
        const dynamicUrlSyncKey = `${URL_SYNC_KEY_BASE}_${tab.toLowerCase().replace(/\s+/g, '_')}`;
        const eventIdForNotif = tab === "New PR Request" ? "pr:approved" : ""; // Example

        const serverDataTable = useServerDataTable<ProcurementRequest>({
            doctype: DOCTYPE,
            columns,
            fetchFields: fieldsToFetch,
            searchableFields: prSearchableFields,
            urlSyncKey: dynamicUrlSyncKey, // Unique key per tab for data table state
            defaultSort: 'modified desc',
            enableRowSelection: false, // Enable selection for delete
            additionalFilters: staticFilters,
        });

        return (
            <DataTable<ProcurementRequest>
                table={serverDataTable.table}
                columns={columns}
                isLoading={serverDataTable.isLoading}
                error={serverDataTable.error}
                totalCount={serverDataTable.totalCount}
                searchFieldOptions={prSearchableFields}
                selectedSearchField={serverDataTable.selectedSearchField}
                onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
                searchTerm={serverDataTable.searchTerm}
                onSearchTermChange={serverDataTable.setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={dateColumns}
                showExportButton={true}
                onExport={'default'}
                isNewRow={(row) => notifications.find(n => n.docname === row.original.name && n.seen === "false" && n.event_id === eventIdForNotif) !== undefined}
            />
        );
    };


// --- Component ---
export const ProcurementRequests: React.FC = () => {
    const { role } = useUserData();
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
    }, [initialTab]);


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

    const { counts } = useDocCountStore();

    // --- Tab Definitions ---
    const adminTabs = useMemo(() => (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
        { label: (<div className="flex items-center"><span>Approve PR</span><span className="ml-2 text-xs font-bold">{counts.pr.pending}</span></div>), value: "Approve PR" },
    ] : []), [role, counts]);

    const userPRExecTabs = useMemo(() => (["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
        { label: (<div className="flex items-center"><span>New PR Request</span><span className="ml-2 text-xs font-bold">{counts.pr.approved}</span></div>), value: "New PR Request" },
        { label: (<div className="flex items-center"><span>In Progress</span><span className="ml-2 text-xs font-bold">{counts.pr.in_progress}</span></div>), value: "In Progress" },
    ] : []), [role, counts]);

    const sentBackTabsConfig = useMemo(() => (["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
        { label: (<div className="flex items-center"><span>Sent Back</span><span className="ml-2 text-xs font-bold">{counts.sb.rejected.pending}</span></div>), value: "Rejected" },
        { label: (<div className="flex items-center"><span>Skipped PR</span><span className="ml-2 rounded text-xs font-bold">{counts.sb.delayed.pending}</span></div>), value: "Delayed" },
        { label: (<div className="flex items-center"><span>Rejected PO</span><span className="ml-2 rounded text-xs font-bold">{counts.sb.cancelled.pending}</span></div>), value: "Cancelled" },
    ] : []), [role, counts]);

    const allTabs = useMemo(() =>
        [
            { label: (<div className="flex items-center"><span>All PRs</span><span className="ml-2 text-xs font-bold">{counts.pr.all}</span></div>), value: "All PRs" },
            { label: (<div className="flex items-center"><span>All SBs</span><span className="ml-2 text-xs font-bold">{counts.sb.all}</span></div>), value: "All SBs" },
        ]
        , [counts, role])


    // --- Notification Handling ---
    const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);


    // --- Static Filters for Data Table based on Tab ---
    // const staticFiltersForDataTable = useMemo(() => {
    //     switch (tab) {
    //         case "New PR Request": return [["workflow_state", "=", "Approved"]]; // For PR Exec to see newly approved PRs
    //         case "In Progress": return [["workflow_state", "=", "In Progress"]]; // PRs being worked on
    //         default: return []; // No static filters if tab renders a different component
    //     }
    // }, [tab]);

    const staticFilters = useMemo(() => getPRStaticFilters(tab), [tab]);

    // --- Fields to Fetch for Data Table ---
    // const fieldsToFetch: (keyof ProcurementRequest | 'name')[] = useMemo(() => [
    //     "name", "creation", "modified", "owner", "project",
    //     "work_package", "procurement_list", "category_list", "workflow_state",
    // ], []);

    const fieldsToFetch = useMemo(() => DEFAULT_PR_FIELDS_TO_FETCH.concat(["modified", 'creation', 'procurement_list', 'category_list']), [])

    const prSearchableFields = useMemo(() => PR_SEARCHABLE_FIELDS.concat([{ value: "owner", label: "Created By", placeholder: "Search by Created By..." },
    ...(tab === "All PRs" ? [
        { value: "workflow_state", label: "Status", placeholder: "Search by Status..." },
    ] : []),

    ]), []);
    // --- Date Filter Columns ---
    const dateColumnsForDataTable = useMemo(() => PR_DATE_COLUMNS, []);

    // --- Column Definitions for Data Table ---
    const dataTableColumns = useMemo<ColumnDef<ProcurementRequest>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#PR" />,
            cell: ({ row }) => {
                const data = row.original; const prId = data.name;
                // Determine event_id based on tab if notifications differ
                const eventIdForNotif = tab === "New PR Request" ? "pr:approved" : (tab === "In Progress" ? "pr:rfqGenerated" : "pr:general"); // Example
                const isNew = notifications.find(n => n.docname === prId && n.seen === "false" && n.event_id === eventIdForNotif);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 group">
                        {tab !== "All PRs" ? (
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/procurement-requests/${prId}?tab=${tab}`}>
                                {prId?.slice(-4)}
                            </Link>
                        ) : (
                            <p>{prId?.slice(-4)}</p>
                        )}
                        {!data.work_package && <Badge className="text-xs">Custom</Badge>}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ItemsHoverCard
                                parentDocId={data}
                                parentDoctype={DOCTYPE} // 'Procurement Requests'
                                childTableName={"order_list"} // Or "procurement_list" - check your DocType
                                isPR={true} // Pass relevant flags
                            />
                        </div>
                    </div>
                );
            }, size: 170,
            meta: {
                exportHeaderName: "PR ID",
                exportValue: (row) => {
                    return row.name
                }
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Created",
                exportValue: (row) => {
                    return formatDate(row.creation)
                }
            }
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
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
                        {categoryItems.length > 0 ? categoryItems.map((cat, index) => <Badge key={`${row.original.name}-${cat.name}_${index}`} variant="outline" className="text-xs">{cat.name}</Badge>) : '--'}
                    </div>
                );
            }, size: 180, enableSorting: false,
            meta: {
                excludeFromExport: true,
            }
        },
        {
            accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
            cell: ({ row }) => {
                const ownerUser = userList?.find((entry) => row.original?.owner === entry.name);
                return (<div className="font-medium truncate">{ownerUser?.full_name || row.original?.owner || "--"}</div>);
            }, size: 180,
            meta: {
                exportHeaderName: "Created By",
                exportValue: (row) => {
                    const ownerUser = userList?.find((entry) => row.owner === entry.name);
                    return ownerUser?.full_name || row.owner || "--";
                }
            }
        },

        ...(tab === "All PRs" ? [
            {
                accessorKey: "workflow_state",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => {
                    const status = row.getValue<string>("workflow_state");
                    const variant = status === "Approved" ? "gray" : status === "In Progress" ? "yellow" : status === "Pending" ? "blue" : ["Sent Back", "Delayed", "Rejected"].includes(status) ? "destructive" : "green";
                    return (
                        <Badge variant={variant} className="text-xs">{status}</Badge>
                    );
                },
                size: 180,
                enableColumnFilter: true
            } as ColumnDef<ProcurementRequest>
        ] : []),
        // Conditional Delete Column
        ...((tab === "New PR Request" && ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role)) ? [{
            id: "actions", header: "Actions",
            cell: ({ row }) => (
                <Button variant="ghost" size="sm" onClick={() => { setDeleteFlagged(row.original); toggleDeleteDialog(); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            ), size: 80,
            meta: {
                excludeFromExport: true,
            }
        } as ColumnDef<ProcurementRequest>] : []),
    ], [tab, role, notifications, projectOptions, userList, handleNewPRSeen]); // Dependencies for columns


    const statusOptions = useMemo(() => [
        { label: "Pending", value: "Pending" },
        { label: "Rejected", value: "Rejected" },
        { label: "Draft", value: "Draft" },
        { label: "Approved", value: "Approved" },
        { label: "In Progress", value: "In Progress" },
        { label: "Partially Approved", value: "Partially Approved" },
        { label: "Vendor Selected", value: "Vendor Selected" },
        { label: "Vendor Approved", value: "Vendor Approved" },
        { label: "Delayed", value: "Delayed" },
        { label: "Sent Back", value: "Sent Back" },

    ], []);


    // --- Faceted Filter Options for Data Table ---
    const facetFilterOptionsForDataTable = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        workflow_state: { title: "Status", options: statusOptions },
    }), [projectOptions]);


    // --- useServerDataTable Hook Instantiation for Data Table Tabs ---
    const shouldRenderDataTable = useMemo(() =>
        ["New PR Request", "In Progress", "All PRs"].includes(tab),
        [tab]);

    // --- Combined Loading & Error States ---
    const isSupportingDataLoading = projectsLoading || userListLoading;
    const supportingDataError = projectsError || userError;

    const handleConfirmDelete = async () => {
        if (deleteFlagged) {
            await handleDeletePR(deleteFlagged.name); // handleDeletePR should handle toast/mutate
            setDeleteFlagged(null); // Clear after action
            toggleDeleteDialog(); // Close dialog
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
        if (["Rejected", "Delayed", "Cancelled", "All SBs"].includes(tab)) return <SentBackRequest tab={tab} />;

        if (shouldRenderDataTable) {
            if (isSupportingDataLoading) return <TableSkeleton />;
            if (supportingDataError) return <AlertDestructive error={supportingDataError} />;

            return (
                <PRDataTableWrapper
                    key={tab} // Key on wrapper ensures complete remount
                    tab={tab}
                    columns={dataTableColumns}
                    fieldsToFetch={fieldsToFetch}
                    prSearchableFields={prSearchableFields}
                    staticFilters={staticFilters}
                    facetFilterOptions={facetFilterOptionsForDataTable}
                    dateColumns={dateColumnsForDataTable}
                    notifications={notifications}
                />
            );
        }
        return <div>Select a tab to view requests.</div>; // Fallback
    };

    return (
        <>
            <div className="flex-1 space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Radio.Group options={adminTabs} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
                    <Radio.Group options={userPRExecTabs} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
                    <Radio.Group options={sentBackTabsConfig} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
                    <Radio.Group options={allTabs} optionType="button" buttonStyle="solid" value={tab} onChange={(e) => handleTabClick(e.target.value)} />
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