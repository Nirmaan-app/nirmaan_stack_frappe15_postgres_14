import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { useToast } from "@/components/ui/use-toast";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
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

    const prSearchableFields: SearchFieldOption[] = useMemo(() => [
            { value: "name", label: "PR ID", placeholder: "Search by PR ID..." , default: true},
            { value: "project", label: "Project ID", placeholder: "Search by Project ID..." }, // Search by Project Link ID
            { value: "owner", label: "Created By", placeholder: "Search by Created By..." },
            // { value: "project_name", label: "Project", placeholder: "Search by Project..." },
            // { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },   // Search by Vendor Link ID
            // { value: "vendor_name", label: "Vendor", placeholder: "Search by Vendor..." },
            { value: "work_package", label: "Work Package", placeholder: "Search by Work Package..." },
            { value: "status", label: "Status", placeholder: "Search by Status..." },
            { value: "procurement_list", label: "Item in PR", placeholder: "Search by Item in PR...", is_json: true },
        ], [])

    // --- Fields to Fetch ---
    const fieldsToFetch: (keyof ProcurementRequest | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "work_package", "procurement_list", "category_list", "workflow_state" // Fetch workflow_state if needed for display/logic
    ], []);

     // --- Date Filter Columns ---
     const dateColumns = useMemo(() => ["creation", "modified"], []);

    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProcurementRequest>[]>(() => [
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
                return <p className="font-medium pr-2">{total === 0 ? "N/A" : formatToRoundedIndianRupee(total)}</p>;
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
        // globalFilter, setGlobalFilter,
        // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle, // Use item search state
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
    } = useServerDataTable<ProcurementRequest>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        searchableFields: prSearchableFields,
        // defaultSearchField: "name", // Removed
        // globalSearchFieldList: globalSearchFields, // For default global search
        // enableItemSearch: true, // Enable item search feature for PRs
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
                    searchFieldOptions={prSearchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder="Search PRs..." // Specific placeholder
                    // showItemSearchToggle={showItemSearchToggle}
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Item Search"
                    // }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns} // Enable date filters for creation/modified
                    showExportButton={true} // Disable export if not needed
                    onExport={'default'}
                    showRowSelection={isRowSelectionActive}
                />
            )}
        </div>
    );
}

export default ApproveSelectVendor;