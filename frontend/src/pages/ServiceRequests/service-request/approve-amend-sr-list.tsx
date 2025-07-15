import React, { useCallback, useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
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
const URL_SYNC_KEY = 'sr_amend_approve'; // Unique key for this table instance

// --- Component ---
export const ApproveSelectAmendSR: React.FC = () => {
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
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();
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
            mark_seen_notification(db, notification);
        }
    }, [db, mark_seen_notification]);


    // --- Static Filters for this View ---
    const staticFilters = useMemo(() => [
        ["status", "=", "Amendment"] // Filter for SRs in "Amendment" status
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
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#SR" />,
            cell: ({ row }) => {
                const data = row.original;
                const srId = data.name;
                const isNew = notifications.find(
                    (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:amended" // Ensure correct event_id
                );
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewSRSeen(isNew)} className="font-medium flex items-center gap-2 relative group">
                        {isNew && (<p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" />)}
                        {/* Link to the page where Amended SR can be approved */}
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/service-requests/${srId}?tab=approve-amended-so`} >
                            {srId?.slice(-5)}
                        </Link>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ItemsHoverCard parentDocId={data} parentDoctype="Service Requests" childTableName="service_order_list" isSR />
                        </div>
                    </div>
                );
            }, size: 150,
            meta: {
                exportHeaderName: "SR ID",
                exportValue: (row) => row.name,
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Created On",
                exportValue: (row) => formatDate(row.creation),
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
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => <div className="font-medium truncate" title={getVendorName(row.original.vendor)}>{getVendorName(row.original.vendor)}</div>,
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Vendor",
                exportValue: (row) => getVendorName(row.vendor),
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
            id: "amended_sr_value", header: ({ column }) => <DataTableColumnHeader column={column} title="Amended Value" />,
            cell: ({ row }) => (<p className="font-medium pr-2">{formatToRoundedIndianRupee(getTotalAmount(row.original.name, 'Service Requests')?.totalWithTax)}</p>),
            size: 150, enableSorting: false,
            meta: {
                exportHeaderName: "Amended Value",
                exportValue: (row) => formatForReport(getTotalAmount(row.name, 'Service Requests')?.totalWithTax),
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
        // enableItemSearch: true, // If searching within service_order_list is needed
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // For bulk approval
        additionalFilters: staticFilters,
    });


    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || vendorsLoading || userListLoading;
    const combinedError = projectsError || vendorsError || userError || listError;

    if (combinedError) {
        return <AlertDestructive error={combinedError} />
    }

    return (
        <div className="flex-1 md:space-y-4">
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
                    // searchPlaceholder="Search Amended SRs..."
                    // showItemSearchToggle={showItemSearchToggle}
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Service Item Search"
                    // }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExportButton={true} // Enable if needed
                    onExport={'default'}
                // toolbarActions={<Button size="sm">Bulk Approve Amended...</Button>} // Placeholder
                />
            )}
        </div>
    );
};

export default ApproveSelectAmendSR;