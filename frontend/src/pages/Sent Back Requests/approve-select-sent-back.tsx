import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { DEFAULT_SB_FIELDS_TO_FETCH, SB_DATE_COLUMNS, SB_SEARCHABLE_FIELDS } from "./config/sentBackCategoryTables.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = 'Sent Back Category';
const URL_SYNC_KEY = 'sb_approve';

// --- Component ---
export const ApproveSelectSentBack: React.FC = () => {
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

    // --- Memoized Calculations & Options ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);

    const getTotal = useMemo(() => memoize((itemList: { list: ProcurementItem[] } | undefined | null): number => {
        let total = 0;
        const items = Array.isArray(itemList?.list) ? itemList.list : [];
        items.forEach((item) => {
            // Assuming quote is the relevant field for sent back items needing re-approval
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

    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]
    ], []);

    // --- Fields to Fetch ---

    const fieldsToFetch = useMemo(() => DEFAULT_SB_FIELDS_TO_FETCH.concat(["creation", "modified", "item_list", "procurement_request"]), [])

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => SB_DATE_COLUMNS, []);

    const sbSearchableFields = useMemo(() => SB_SEARCHABLE_FIELDS.concat([{ value: "procurement_request", label: "PR No.", placeholder: "Search by PR No..." }, { value: "owner", label: "Created By", placeholder: "Search by Created By..." }]), []);

    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<SentBackCategory>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="SB ID" />,
            cell: ({ row }) => {
                const data = row.original;
                const sbId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === sbId && item.seen === "false" && item.event_id === "sb:vendorSelected" // Ensure correct event_id
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSBSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && ( <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" /> )}
                         {/* Update Link target as needed */}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/purchase-orders/${sbId}?tab=Approve Sent Back PO`} >
                            {sbId?.slice(-5)} {/* Display last 5 chars */}
                        </Link>
                        <Badge variant="secondary" className="text-xs">{data.type || 'Unknown Type'}</Badge>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                           {/* Pass correct item structure to hover card */}
                           <ItemsHoverCard order_list={Array.isArray(data.item_list?.list) ? data.item_list.list : []} isSB />
                        </div>
                    </div>
                );
            }, size: 170, // Adjusted size
        },
        {
            accessorKey: "procurement_request", header: ({ column }) => <DataTableColumnHeader column={column} title="PR No." />,
            cell: ({ row }) => (<div className="font-medium">{row.getValue("procurement_request")?.slice(-4) ?? '--'}</div>),
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
                // Fetch project_name if not directly available (or join in backend later)
                const project = projectOptions.find(i => i.value === row.original.project);
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
            id: "sent_back_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotal(row.original.item_list))}</p>),
            size: 150, enableSorting: false,
        }

    ], [notifications, projectOptions, userList, handleNewSBSeen, getTotal]); // Updated dependencies


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        // Add type if needed: type: { title: "Type", options: [...] },
    }), [projectOptions]);

    // --- Use the Server Data Table Hook ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        // globalFilter, setGlobalFilter,
        // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle, // Use item search state
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
    } = useServerDataTable<SentBackCategory>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        searchableFields: sbSearchableFields,
        // globalSearchFieldList: globalSearchFields,
        // --- Item search might not be applicable here unless searching item_list makes sense ---
        // enableItemSearch: true, // Set to true if you want to search inside item_list
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // Enable selection for bulk approval/rejection
        additionalFilters: staticFilters,
        // --- NEW: Add the specific filter flag ---
        requirePendingItems: true, // Filter for items with status="Pending"
    });

    // --- Combined Loading State & Error Handling ---
    const isLoading = projectsLoading || userListLoading;
    const error = projectsError || userError || listError;

    if (error) {
        return <AlertDestructive error={error} />
    }

    return (
        <div className="flex-1 md:space-y-4">
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<SentBackCategory>
                    table={table}
                    columns={columns}
                    // data={data} // Data is internally managed
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={sbSearchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder="Search Sent Back Items..."
                    // showItemSearchToggle={showItemSearchToggle}
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Item Search" // Or specific label if needed
                    // }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    onExport={'default'}
                    // toolbarActions={<Button size="sm">Bulk Actions...</Button>}
                />
            )}
        </div>
    );
}

export default ApproveSelectSentBack;