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
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceItemType, ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { DEFAULT_SR_FIELDS_TO_FETCH, SR_DATE_COLUMNS, SR_SEARCHABLE_FIELDS } from "../config/srTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = 'Service Requests';
const URL_SYNC_KEY = 'sr_approve_select'; // Unique key for this table instance

// --- Component ---
export const ApproveSelectSR: React.FC = () => {
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { getTotalAmount } = useOrderTotals()

    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendorsList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({ vendorTypes: ["Service", "Material & Service"] });

    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList(); // For owner display
    const { notifications, mark_seen_notification } = useNotificationStore();

    // --- Memoized Options & Calculations ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);
    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList]);

    const getVendorName = useCallback(memoize((vendorId: string | undefined): string => {
        return vendorsList?.find(vendor => vendor.name === vendorId)?.vendor_name || vendorId || "--";
    }), [vendorsList]);

    // --- Notification Handling ---
    const handleNewSRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification]);

    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["status", "=", "Vendor Selected"] // This view specifically handles SRs in "Vendor Selected" state
    ], []);
    // --- Fields to Fetch ---
    const fieldsToFetch = useMemo(() => DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation", "modified", 'service_order_list', 'service_category_list'
    ]), [])

    const srSearchableFields = useMemo(() => SR_SEARCHABLE_FIELDS.concat([
        { value: "owner", label: "Created By", placeholder: "Search by Created By..." },
    ]), [])

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => SR_DATE_COLUMNS, []);

    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ServiceRequests>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#WO" />,
            cell: ({ row }) => {
                const data = row.original;
                const srId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:vendorSelected" // Ensure this event_id is correct
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && (<p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />)}
                        {/* Link to the page where SR can be approved (e.g., service-request/:id?tab=approve-service-order) */}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/service-requests/${srId}?tab=approve-service-order`} >
                            {srId?.slice(-5)}
                        </Link>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ItemsHoverCard parentDocId={data} parentDoctype="Service Requests" childTableName="service_order_list" isSR />
                        </div>
                    </div>
                );
            }, size: 150,
            meta: {
                exportHeaderName: "#SR",
                exportValue: (row) => {
                    return row.name;
                }
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Created On",
                exportValue: (row) => {
                    return formatDate(row.creation);
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
            accessorKey: "vendor", // Filter by vendor ID
            header: ({ column }) => <DataTableColumnHeader column={column} title="Selected Vendor" />,
            cell: ({ row }) => <div className="font-medium truncate" title={getVendorName(row.original.vendor)}>{getVendorName(row.original.vendor)}</div>,
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Selected Vendor",
                exportValue: (row) => {
                    return getVendorName(row.vendor);
                }
            }
        },
        {
            accessorKey: "service_category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.getValue("service_category_list") as { list: { name: string }[] } | undefined;
                const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
                return (
                    <div className="flex flex-wrap gap-1 items-start justify-start max-w-[200px]">
                        {categoryItems.length > 0 ? categoryItems.map((obj) => <Badge key={obj.name} variant="outline" className="text-xs">{obj.name}</Badge>) : '--'}
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
        {
            id: "sr_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Est. Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotalAmount(row.original.name, 'Service Requests')?.totalWithTax)}</p>),
            size: 150, enableSorting: false,
            meta: {
                exportHeaderName: "Est. Value",
                exportValue: (row) => {
                    return formatForReport(getTotalAmount(row.name, 'Service Requests')?.totalWithTax);
                }
            }
        }
    ], [notifications, projectOptions, vendorOptions, userList, handleNewSRSeen, getVendorName, getTotalAmount]);


    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        vendor: { title: "Vendor", options: vendorOptions },
    }), [projectOptions, vendorOptions]);


    // --- Use the Server Data Table Hook ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        // globalFilter, setGlobalFilter,
        // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
    } = useServerDataTable<ServiceRequests>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        searchableFields: srSearchableFields,
        // globalSearchFieldList: globalSearchFields,
        // enableItemSearch: true, // If you want to search within service_order_list items
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // For bulk approval if needed
        additionalFilters: staticFilters,
    });


    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || vendorsLoading || userListLoading;
    const combinedError = projectsError || vendorsError || userError || listError;

    if (combinedError) {
        return <AlertDestructive error={combinedError} />
    }

    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-80px)] overflow-hidden' : ''}`}>
            {isLoading ? (
                <TableSkeleton />
            ) : (
                <DataTable<ServiceRequests>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={srSearchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder="Search SRs (Vendor Selected)..."
                    // showItemSearchToggle={showItemSearchToggle}
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Service Item Search"
                    // }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    onExport={'default'}
                // toolbarActions={<Button size="sm">Bulk Approve...</Button>} // Placeholder for future actions
                />
            )}
        </div>
    );
};

export default ApproveSelectSR;