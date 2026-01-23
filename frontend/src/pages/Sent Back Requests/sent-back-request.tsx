import React, { useCallback, useContext, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Trash2 } from "lucide-react";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TailSpin } from "react-loader-spinner";


// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useFacetValues } from "@/hooks/useFacetValues";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";

// --- Types ---
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "../../components/helpers/ItemsHoverCard";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { DEFAULT_SB_FIELDS_TO_FETCH, getSentBackStaticFilters, SB_DATE_COLUMNS, SB_SEARCHABLE_FIELDS } from "./config/sentBackCategoryTables.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Badge } from "@/components/ui/badge";
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
import { UserContext } from "@/utils/auth/UserProvider";

// --- Constants ---
const DOCTYPE = 'Sent Back Category';
const URL_SYNC_KEY = 'sb'; // Unique key for URL state for this table instance

interface SentBackRequestProps {
    tab: string; // e.g., "Rejected", "Delayed", "Cancelled"
}

const SBDataTableWrapper: React.FC<{
    tab: string;
    columns: any;
    fieldsToFetch: string[];
    sbSearchableFields: SearchFieldOption[];
    staticFilters: any[];
    facetFilterOptions: any;
    dateColumns: any;
}> = ({
    tab,
    columns,
    fieldsToFetch,
    sbSearchableFields,
    staticFilters,
    facetFilterOptions,
    dateColumns
}) => {
        // Generate urlSyncKey inside the wrapper
        const dynamicUrlSyncKey = `${URL_SYNC_KEY}_${tab.toLowerCase().replace(/\s+/g, '_')}`;

        // --- useServerDataTable Hook Instantiation ---
        const {
            table, totalCount, isLoading: listIsLoading, error: listError,
            selectedSearchField: tableSelectedSearchField, setSelectedSearchField,
            searchTerm: tableSearchTerm, setSearchTerm,
            columnFilters
        } = useServerDataTable<SentBackCategory>({
            doctype: DOCTYPE,
            columns: columns,
            fetchFields: fieldsToFetch,
            searchableFields: sbSearchableFields,

            urlSyncKey: dynamicUrlSyncKey, // Dynamic URL key based on tab/type
            defaultSort: 'modified desc',
            enableRowSelection: false, // For delete action
            additionalFilters: staticFilters,
            requirePendingItems: tab !== "All SBs" ? true : false, // This is crucial and should be handled correctly
        });

        const { facetOptions: projectFacets } = useFacetValues({
            doctype: DOCTYPE,
            field: 'project',
            currentFilters: columnFilters,
            searchTerm: tableSearchTerm,
            selectedSearchField: tableSelectedSearchField,
            additionalFilters: staticFilters
        });

        const combinedFacetOptions = {
            ...facetFilterOptions,
            project: { title: "Project", options: projectFacets }
        };

        return (
            <DataTable<SentBackCategory>
                table={table}
                columns={columns}
                isLoading={listIsLoading}
                error={listError}
                totalCount={totalCount}
                searchFieldOptions={sbSearchableFields}
                selectedSearchField={tableSelectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={tableSearchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={combinedFacetOptions}
                dateFilterColumns={dateColumns}
                showExportButton={true} // Optional
                onExport={'default'}
            />
        );
    };

// --- Component ---
export const SentBackRequest: React.FC<SentBackRequestProps> = ({ tab }) => {
    const { role } = useUserData();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { deleteDialog, toggleDeleteDialog } = useContext(UserContext);

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

    const getTotal = useMemo(() => memoize((order_list: ProcurementRequestItemDetail[]): number => {
        let total = 0;
        const items = Array.isArray(order_list) ? order_list : [];
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


    // --- Delete State ---
    const [deleteFlagged, setDeleteFlagged] = useState<SentBackCategory | null>(null);


    // --- Static Filters for this View (based on type/tab) ---
    const staticFilters = useMemo(() => getSentBackStaticFilters(tab!), [tab]);

    // --- Fields to Fetch ---
    const fieldsToFetch = useMemo(() => DEFAULT_SB_FIELDS_TO_FETCH.concat([
        'creation', 'modified', 'item_list', 'procurement_request'
    ]), [])

    const sbSearchableFields = useMemo(() => SB_SEARCHABLE_FIELDS.concat([
        { value: "procurement_request", label: "PR ID", placeholder: "Search by PR ID..." },
        { value: "owner", label: "Created By", placeholder: "Search by Created By..." },
        ...(tab === "All SBs" ? [
            { value: "type", label: "Type", placeholder: "Search by Type..." },
            { value: "workflow_state", label: "Status", placeholder: "Search by Status..." },
        ] : []),
    ]), [tab])

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => SB_DATE_COLUMNS, []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<SentBackCategory>[]>(() => [
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
                        {isNew && tab !== "All SBs" && <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />}
                        {tab !== "All SBs" ? (
                            <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/sent-back-requests/${sbId.split("/").join("&=")}?tab=${tab}`} >
                                {sbId?.slice(-5)}
                            </Link>
                        ) : (
                            <>
                                <p>{sbId?.slice(-5)}</p>
                                {data.type && <Badge variant="secondary" className="text-xs">{data.type}</Badge>}
                            </>
                        )}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ItemsHoverCard
                                parentDoc={data}
                                parentDoctype={DOCTYPE} // 'Sent Back Requests'
                                childTableName={"order_list"} // Or "procurement_list" - check your DocType
                                isSB={true} // Pass relevant flags
                            />
                        </div>
                    </div>
                );
            }, size: 180,
            meta: {
                exportHeaderName: "SB ID",
                exportValue: (row: SentBackCategory) => row.name,
            }
        },
        {
            accessorKey: "procurement_request", header: ({ column }) => <DataTableColumnHeader column={column} title="#PR" />,
            cell: ({ row }) => <div className="font-medium">{(row.getValue("procurement_request") as string)?.slice(-4) ?? '--'}</div>,
            size: 100,
            meta: {
                exportHeaderName: "PR ID",
                exportValue: (row: SentBackCategory) => row.procurement_request,
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Date Created",
                exportValue: (row: SentBackCategory) => formatDate(row.creation),
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
                exportValue: (row: SentBackCategory) => {
                    const project = projectOptions.find(p => p.value === row.project);
                    return project?.label || row.project;
                }
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
                exportValue: (row: SentBackCategory) => {
                    const ownerUser = userList?.find((entry) => row.owner === entry.name);
                    return ownerUser?.full_name || row.owner || "--";
                }
            }
        },
        {
            id: "sent_back_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Estd. Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotal(row.original.order_list))}</p>),
            size: 150, enableSorting: false,
            meta: {
                exportHeaderName: "Estd. Value",
                exportValue: (row: SentBackCategory) => formatToRoundedIndianRupee(getTotal(row.order_list)),
            }
        },

        ...(tab === "All SBs" ? [
            {
                accessorKey: "workflow_state",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => {
                    const status = row.getValue("workflow_state") as string;
                    const variant = status === "Vendor Selected" ? "gray" : status === "Pending" ? "blue" : ["Sent Back"].includes(status) ? "destructive" : "green";
                    return (
                        <Badge variant={variant} className="text-xs">{status}</Badge>
                    );
                },
                size: 180,
                enableColumnFilter: true
            } as ColumnDef<SentBackCategory>
        ] : []),
        ...((["Nirmaan Project Lead Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role)) && tab !== "All SBs" ? [{ // Assuming Admins/Leads can delete sent-back items
            id: "actions", header: "Actions",
            cell: ({ row }) => (
                <Button variant="ghost" size="sm" onClick={() => { setDeleteFlagged(row.original); toggleDeleteDialog(); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            ), size: 80,
            meta: {
                excludeFromExport: true,
            }
        } as ColumnDef<SentBackCategory>] : []),
    ], [tab, notifications, projectOptions, userList, handleNewSBSeen, getTotal, role]);


    const typeOptions = useMemo(() => [
        { label: "Rejected", value: "Rejected" },
        { label: "Delayed", value: "Delayed" },
        { label: "Cancelled", value: "Cancelled" },
    ], []);

    const statusOptions = useMemo(() => [
        { label: "Pending", value: "Pending" },
        { label: "Vendor Selected", value: "Vendor Selected" },
        { label: "Partially Approved", value: "Partially Approved" },
        { label: "Approved", value: "Approved" },
        { label: "Sent Back", value: "Sent Back" },
    ], []);


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        // type: { title: "Type", options: [{label: "Rejected", value:"Rejected"}, ...]} // If type needs to be a facet
        workflow_state: { title: "Status", options: statusOptions },
        type: { title: "Type", options: typeOptions },
    }), [projectOptions]);

    // --- Delete Handler ---
    const { handleDeleteSB, deleteLoading } = usePRorSBDelete();

    const handleConfirmDelete = async () => {
        if (deleteFlagged) {
            await handleDeleteSB(deleteFlagged.name);
            setDeleteFlagged(null);
            // Dialog close and data refresh handled by hook + socket listener
        }
    };

    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || userListLoading;
    const combinedError = projectsError || userError;

    if (combinedError) {
        <AlertDestructive error={combinedError} />
    }

    return (
        <div className="flex-1 md:space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <SBDataTableWrapper
                    key={tab} // Key on wrapper ensures complete remount
                    tab={tab}
                    columns={columns}
                    fieldsToFetch={fieldsToFetch}
                    sbSearchableFields={sbSearchableFields}
                    staticFilters={staticFilters}
                    facetFilterOptions={facetFilterOptions}
                    dateColumns={dateColumns}
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