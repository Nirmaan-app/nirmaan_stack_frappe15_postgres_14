import React, { Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ColumnDef, Row } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Trash2 } from "lucide-react";

// --- Tab Configuration ---
import {
    PR_TABS,
    PR_ADMIN_TAB_OPTIONS,
    PR_EXEC_TAB_OPTIONS,
    PR_SENTBACK_TAB_OPTIONS,
    PR_ALL_TAB_OPTIONS,
    PR_ADMIN_ROLES,
    PR_EXEC_ROLES,
    PRTabOption,
} from "./config/prTabs.constants";

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
import { useFacetValues } from "@/hooks/useFacetValues";
import { urlStateManager } from "@/utils/urlStateManager";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

// --- Types ---
import { ProcurementRequest, Category } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";

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
    exportFileName?: string;
}> = ({
    tab,
    columns,
    fieldsToFetch,
    prSearchableFields,
    staticFilters,
    facetFilterOptions,
    dateColumns,
    notifications,
    exportFileName
}) => {
        const dynamicUrlSyncKey = `${URL_SYNC_KEY_BASE}_${tab.toLowerCase().replace(/\s+/g, '_')}`;
        const eventIdForNotif = tab === PR_TABS.NEW_PR_REQUEST ? "pr:approved" : ""; // Example

        // --- CEO Hold Row Highlighting ---
        const { ceoHoldProjectIds } = useCEOHoldProjects();

        const getRowClassName = useCallback(
            (row: Row<ProcurementRequest>) => {
                const projectId = row.original.project;
                if (projectId && ceoHoldProjectIds.has(projectId)) {
                    return CEO_HOLD_ROW_CLASSES;
                }
                return undefined;
            },
            [ceoHoldProjectIds]
        );

        const {
            table,
            totalCount,
            isLoading: listIsLoading,
            error: listError,
            columnFilters,
            searchTerm: tableSearchTerm,
            setSearchTerm,
            selectedSearchField: tableSelectedSearchField,
            setSelectedSearchField
        } = useServerDataTable<ProcurementRequest>({
            doctype: DOCTYPE,
            columns,
            fetchFields: fieldsToFetch,
            searchableFields: prSearchableFields,
            urlSyncKey: dynamicUrlSyncKey, // Unique key per tab for data table state
            defaultSort: 'modified desc',
            enableRowSelection: false, // Enable selection for delete
            additionalFilters: staticFilters,
        });

        const { facetOptions: projectFacets } = useFacetValues({
            doctype: DOCTYPE,
            field: 'project',
            currentFilters: columnFilters,
            searchTerm: tableSearchTerm,
            selectedSearchField: tableSelectedSearchField,
            additionalFilters: staticFilters,
        });

        const { facetOptions: wpFacets } = useFacetValues({
            doctype: DOCTYPE,
            field: 'work_package',
            currentFilters: columnFilters,
            searchTerm: tableSearchTerm,
            selectedSearchField: tableSelectedSearchField,
            additionalFilters: staticFilters,
        });

        const { facetOptions: ownerFacets } = useFacetValues({
            doctype: DOCTYPE,
            field: 'owner',
            currentFilters: columnFilters,
            searchTerm: tableSearchTerm,
            selectedSearchField: tableSelectedSearchField,
            additionalFilters: staticFilters,
        });

        const { facetOptions: statusFacets } = useFacetValues({
            doctype: DOCTYPE,
            field: 'workflow_state',
            currentFilters: columnFilters,
            searchTerm: tableSearchTerm,
            selectedSearchField: tableSelectedSearchField,
            additionalFilters: staticFilters,
            enabled: tab === PR_TABS.ALL_PRS
        });

        const combinedFacetOptions = {
            ...facetFilterOptions,
            project: { title: "Project", options: projectFacets },
            work_package: { title: "Package", options: wpFacets },
            owner: { title: "Created By", options: ownerFacets },
            workflow_state: tab === PR_TABS.ALL_PRS ? { title: "Status", options: statusFacets } : facetFilterOptions.workflow_state
        };

        return (
            <DataTable<ProcurementRequest>
                table={table}
                columns={columns}
                isLoading={listIsLoading}
                error={listError}
                totalCount={totalCount}
                searchFieldOptions={prSearchableFields}
                selectedSearchField={tableSelectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={tableSearchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={combinedFacetOptions}
                dateFilterColumns={dateColumns}
                showExportButton={true}
                onExport={'default'}
                exportFileName={exportFileName}
                isNewRow={(row) => notifications.find(n => n.docname === row.original.name && n.seen === "false" && n.event_id === eventIdForNotif) !== undefined}
                getRowClassName={getRowClassName}
            />
        );
    };


// --- Component ---
export const ProcurementRequests: React.FC = () => {
    const { role } = useUserData();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- Tab State Management using urlStateManager ---
    const isAdmin = useMemo(() => PR_ADMIN_ROLES.includes(role), [role]);
    const isExec = useMemo(() => PR_EXEC_ROLES.includes(role), [role]);

    const initialTab = useMemo(() => {
        const adminDefault = PR_TABS.APPROVE_PR;
        const userDefault = PR_TABS.NEW_PR_REQUEST;
        return getUrlStringParam("tab", isAdmin ? adminDefault : userDefault);
    }, [isAdmin]);

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

    const { data: wp_list, isLoading: wpLoading, error: wpError } = useFrappeGetDocList<ProcurementPackages>(
        "Procurement Packages", {
        fields: ["work_package_name"],
        orderBy: { field: "work_package_name", order: "asc" },
        limit: 0,
    }, "All_Work_Packages_For_PR_Page_Filter");

    // --- Dialog State for Delete ---
    const [deleteDialog, setDeleteDialog] = useState(false); // Replaced UserContext for local state
    const toggleDeleteDialog = () => setDeleteDialog(prev => !prev);
    const [deleteFlagged, setDeleteFlagged] = useState<ProcurementRequest | null>(null);
    const { handleDeletePR, deleteLoading } = usePRorSBDelete(); // Pass mutate if needed


    // --- Memoized Options and Counts ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);

    const userOptions = useMemo(() => userList?.map(u => ({ label: u.full_name, value: (u.full_name === "Administrator" ? "Administrator" : u.name) })) || [], [userList]);

    const workPackageOptions = useMemo(() => {
        const packages = wp_list?.map(wp => ({ label: wp.work_package_name!, value: wp.work_package_name! })) || [];
        packages.unshift({ label: "Custom", value: "" });
        return packages;
    }, [wp_list]);

    const { counts } = useDocCountStore();

    // --- Filter tabs based on role ---
    const adminTabsFiltered = useMemo(() => isAdmin ? PR_ADMIN_TAB_OPTIONS : [], [isAdmin]);
    const execTabsFiltered = useMemo(() => isExec ? PR_EXEC_TAB_OPTIONS : [], [isExec]);
    const sentBackTabsFiltered = useMemo(() => isExec ? PR_SENTBACK_TAB_OPTIONS : [], [isExec]);


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

    const fieldsToFetch = useMemo(() => DEFAULT_PR_FIELDS_TO_FETCH.concat(["modified", 'creation', 'category_list', 'order_list']), [])

    const prSearchableFields = useMemo(() => PR_SEARCHABLE_FIELDS.concat([{ value: "owner", label: "Created By", placeholder: "Search by Created By..." },
    ...(tab === PR_TABS.ALL_PRS ? [
        { value: "workflow_state", label: "Status", placeholder: "Search by Status..." },
    ] : []),

    ]), [tab]);
    // --- Date Filter Columns ---
    const dateColumnsForDataTable = useMemo(() => PR_DATE_COLUMNS, []);

    // --- Column Definitions for Data Table ---
    const dataTableColumns = useMemo<ColumnDef<ProcurementRequest>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#PR" />,
            cell: ({ row }) => {
                const data = row.original; const prId = data.name;
                // Determine event_id based on tab if notifications differ
                const eventIdForNotif = tab === PR_TABS.NEW_PR_REQUEST ? "pr:approved" : (tab === PR_TABS.IN_PROGRESS ? "pr:rfqGenerated" : "pr:general"); // Example
                const isNew = notifications.find(n => n.docname === prId && n.seen === "false" && n.event_id === eventIdForNotif);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 group">
                        {tab !== PR_TABS.ALL_PRS ? (
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/procurement-requests/${prId}?tab=${tab}`}>
                                {prId?.slice(-4)}
                            </Link>
                        ) : (
                            <p>{prId?.slice(-4)}</p>
                        )}
                        {!data.work_package && <Badge className="text-xs">Custom</Badge>}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ItemsHoverCard
                                parentDoc={data}
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
                exportValue: (row: ProcurementRequest) => row.name
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Created",
                exportValue: (row: ProcurementRequest) => {
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
                exportValue: (row: ProcurementRequest) => {
                    const project = projectOptions.find(p => p.value === row.project);
                    return project?.label || row.project;
                }
            }
        },
        {
            accessorKey: "work_package", header: ({ column }) => <DataTableColumnHeader column={column} title="Package" />,
            cell: ({ row }) => <div className="font-medium truncate">{row.getValue("work_package") || "--"}</div>,
            enableColumnFilter: true, size: 150,
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
                exportHeaderName: "Categories",
                exportValue: (row: ProcurementRequest) => {
                    const categories = (row.category_list as { list: Category[] } | undefined)?.list || [];
                    return categories.map(c => c.name).join(", ");
                }
            }
        },
        {
            accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
            cell: ({ row }) => {
                const ownerUser = userList?.find((entry) => row.original?.owner === entry.name);
                return (<div className="font-medium truncate">{ownerUser?.full_name || row.original?.owner || "--"}</div>);
            }, size: 180,
            enableColumnFilter: true,
            meta: {
                exportHeaderName: "Created By",
                exportValue: (row: ProcurementRequest) => {
                    const ownerUser = userList?.find((entry) => row.owner === entry.name);
                    return ownerUser?.full_name || row.owner || "--";
                }
            }
        },

        ...(tab === PR_TABS.ALL_PRS ? [
            {
                accessorKey: "workflow_state",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => {
                    const status = row.getValue("workflow_state") as string;
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
        ...((tab === PR_TABS.NEW_PR_REQUEST && ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role)) ? [{
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
    ], [tab, role, notifications, projectOptions, userList, workPackageOptions, handleNewPRSeen]); // Dependencies for columns


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
        work_package: { title: "Package", options: workPackageOptions },
        owner: { title: "Created By", options: userOptions }
    }), [projectOptions, statusOptions, workPackageOptions, userOptions]); // Add new dependencies


    // --- useServerDataTable Hook Instantiation for Data Table Tabs ---
    const shouldRenderDataTable = useMemo(() =>
        [PR_TABS.NEW_PR_REQUEST, PR_TABS.IN_PROGRESS, PR_TABS.ALL_PRS].includes(tab as any),
        [tab]);

    // --- Combined Loading & Error States ---
    const isSupportingDataLoading = projectsLoading || userListLoading || wpLoading;
    const supportingDataError = projectsError || userError || wpError;

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

    // Render a single tab button
    const renderTabButton = (option: PRTabOption) => {
        const count = option.countKey.split('.').reduce((acc: any, part: string) => acc && acc[part], counts) ?? 0;
        const isActive = tab === option.value;
        return (
            <button
                key={option.value}
                type="button"
                onClick={() => handleTabClick(option.value)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                    ${isActive
                        ? "bg-sky-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
            >
                {option.label}
                <span className={`text-xs font-bold ${isActive ? "opacity-90" : "opacity-70"}`}>
                    {count}
                </span>
            </button>
        );
    };

    // --- Render Logic ---
    const renderCurrentTab = () => {
        if (tab === PR_TABS.APPROVE_PR) return <ApprovePR />; // ApprovePR now uses its own useServerDataTable
        if ([PR_TABS.REJECTED, PR_TABS.DELAYED, PR_TABS.CANCELLED, "All SBs"].includes(tab as any)) return <SentBackRequest tab={tab} />;

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
                    exportFileName={`${tab.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`}
                />
            );
        }
        return <div>Select a tab to view requests.</div>; // Fallback
    };

    return (
        <>
            <div className="flex-1 space-y-4">
                {/* Tab Navigation - Custom Tailwind buttons */}
                <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                    <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 pb-1 sm:pb-0">
                        {/* Admin Tabs */}
                        {adminTabsFiltered.length > 0 && (
                            <>
                                {adminTabsFiltered.map(renderTabButton)}
                                {/* Separator between admin and exec tabs */}
                                <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                            </>
                        )}
                        {/* Exec Tabs */}
                        {execTabsFiltered.length > 0 && (
                            <>
                                {execTabsFiltered.map(renderTabButton)}
                                <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                            </>
                        )}
                        {/* Sent Back Tabs */}
                        {sentBackTabsFiltered.length > 0 && (
                            <>
                                {sentBackTabsFiltered.map(renderTabButton)}
                                <div className="w-px h-5 sm:h-6 bg-gray-300 mx-0.5 sm:mx-1 shrink-0" />
                            </>
                        )}
                        {/* All PRs Tabs */}
                        {PR_ALL_TAB_OPTIONS.map(renderTabButton)}
                    </div>
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