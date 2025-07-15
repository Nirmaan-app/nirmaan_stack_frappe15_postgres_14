import React, { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Trash2 } from 'lucide-react';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SRDeleteConfirmationDialog } from "../components/SRDeleteConfirmationDialog";
import { Button } from "@/components/ui/button";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";

// --- Types ---
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useServiceRequestLogic } from "../hooks/useServiceRequestLogic";
import { DEFAULT_SR_FIELDS_TO_FETCH, SR_DATE_COLUMNS, SR_SEARCHABLE_FIELDS } from "../config/srTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = 'Service Requests';
const URL_SYNC_KEY = 'sr_select_vendor'; // Unique key for this table instance

// --- Component ---
export const SelectServiceVendorList: React.FC = () => {
    const { role, user_id } = useUserData(); // Get user_id for delete check
    // const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- Dialog State for Delete ---
    const [itemToDelete, setItemToDelete] = useState<ServiceRequests | null>(null);

    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();


    // --- Memoized Options ---
    const projectOptions = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name })) || [], [projects]);

    // --- Static Filters for this View ---
    // This view shows SRs in "Created", "Rejected", or "Edit" status for vendor selection
    const staticFilters = useMemo(() => [
        ["status", "in", ["Created", "Rejected", "Edit"]]
    ], []);

    // --- Fields to Fetch ---
    const fieldsToFetch = useMemo(() => DEFAULT_SR_FIELDS_TO_FETCH.concat([
        "creation", "modified", 'service_order_list', 'service_category_list'
    ]), [])

    const srSearchableFields = useMemo(() => SR_SEARCHABLE_FIELDS.filter(f => f.value !== "vendor").concat([
        { value: "owner", label: "Created By", placeholder: "Search by Created By..." },
        { value: "status", label: "Status", placeholder: "Search by Status..." },
    ]), [])

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => SR_DATE_COLUMNS, []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ServiceRequests>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="#SR" />,
            cell: ({ row }) => {
                const data = row.original;
                const srName = data.name;
                return (
                    <div className="font-medium flex items-center gap-2 group">
                        <Link className="underline hover:underline-offset-2 whitespace-nowrap" to={`/service-requests/${srName}?tab=choose-vendor`} >
                            {srName?.slice(-4)}
                        </Link>
                        {/* Adapt ItemsHoverCard or create ServiceItemsHoverCard if structure differs significantly */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                             <ItemsHoverCard parentDocId={data} parentDoctype="Service Requests" childTableName="service_order_list" isSR />
                        </div>
                    </div>
                );
            }, size: 150,
            meta: {
                exportHeaderName: "#SR",
                exportValue: (row) => {
                    return row.name
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
            accessorKey: "service_category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.getValue("service_category_list") as { list: { name: string }[] } | undefined;
                const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
                return (
                    <div className="flex flex-wrap gap-1 items-start justify-start max-w-[200px]">
                        {categoryItems.length > 0
                            ? categoryItems.map((obj) => <Badge key={obj.name} variant="secondary" className="text-xs">{obj.name}</Badge>)
                            : '--'}
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
            accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => {
                const status = row.getValue("status") as string;
                let variant: "red" | "yellow" | "orange" | "default" = "default";
                if (status === "Rejected") variant = "red";
                else if (status === "Created") variant = "yellow";
                else if (status === "Edit") variant = "orange";
                return <Badge variant={variant}>{status}</Badge>;
            }, size: 120, enableColumnFilter: true,
            meta: {
                exportHeaderName: "Status",
                exportValue: (row) => {
                    return row.status;
                }
            }
        },
        {
            id: 'actions', header: 'Actions',
            cell: ({ row }) => {
                const serviceRequest = row.original;
                const canDelete = serviceRequest.owner === user_id || role === "Nirmaan Admin Profile";
                if (!canDelete) return null;

                return (
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/80"
                        disabled={isDeleting} onClick={() => setItemToDelete(serviceRequest)}
                        aria-label={`Delete SR ${serviceRequest.name}`}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                );
            }, size: 80,
            meta: {
                excludeFromExport: true,
            }
        },
    ], [projectOptions, userList, role, user_id]); // Dependencies

    // --- Faceted Filter Options ---
    const statusOptions = useMemo(() => [
        { label: "Created", value: "Created" },
        { label: "Rejected", value: "Rejected" },
        { label: "Edit", value: "Edit" },
    ], []);

    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        status: { title: "Status", options: statusOptions },
    }), [projectOptions, statusOptions]);

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
        // enableItemSearch: true,
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'modified desc',
        enableRowSelection: false, // For potential bulk actions
        additionalFilters: staticFilters,
    });

    // Use the custom hook for deletion logic
    const { deleteServiceRequest, isDeleting } = useServiceRequestLogic({
        onSuccess: (deletedSrName) => {
            refetch()
            setItemToDelete(null);
        },
        onError: (error, srName) => {
            console.error(`Error deleting SR ${srName} from table view:`, error);
        }
    });


    // Handler for the dialog confirmation
    const handleConfirmDelete = () => {
        if (itemToDelete) {
            deleteServiceRequest(itemToDelete.name); // Call the hook's function
        }
    }

    // --- Delete Logic ---
    // const { call: deleteDoc } = useFrappeDeleteDoc();
    // const handleConfirmDelete = async () => {
    //     if (itemToDelete) {
    //         setIsDeleting(true);
    //         try {
    //             await deleteDoc(DOCTYPE, itemToDelete.name);
    //             toast({ title: "Success", description: `Service Request ${itemToDelete.name} deleted.` });
    //             setItemToDelete(null);
    //             refetch(); // Refetch data after successful deletion
    //         } catch (err: any) {
    //             console.error("Error deleting Service Request:", err);
    //             toast({ title: "Error", description: err.message || "Could not delete Service Request.", variant: "destructive" });
    //         } finally {
    //             setIsDeleting(false);
    //         }
    //     }
    // };

    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || userListLoading;
    const combinedError = projectsError || userError || listError;

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
                    // searchPlaceholder="Search Service Requests..."
                    // showItemSearchToggle={showItemSearchToggle} // Enable if item search is configured for SR
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

            <SRDeleteConfirmationDialog
                open={!!itemToDelete}
                onOpenChange={() => setItemToDelete(null)}
                itemName={itemToDelete?.name}
                itemType="Service Request"
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
            />
        </div>
    );
};

export default SelectServiceVendorList;