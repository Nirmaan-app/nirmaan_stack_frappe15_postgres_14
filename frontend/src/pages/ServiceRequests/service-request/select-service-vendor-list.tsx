// import React, { useState, useMemo, useCallback } from "react"; // Import useState and useCallback
// import { Link } from "react-router-dom";
// import { ColumnDef } from "@tanstack/react-table";
// import { useFrappeDocTypeEventListener, useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk"; // Import useFrappeDeleteDoc
// import { Trash2 } from 'lucide-react'; // Import Trash2 icon

// // Your existing imports
// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
// import { Badge } from "@/components/ui/badge";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { useToast } from "@/components/ui/use-toast";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { formatDate } from "@/utils/FormatDate";
// import { SRDeleteConfirmationDialog } from "../components/SRDeleteConfirmationDialog";
// import { Button } from "@/components/ui/button";
// import { useUserData } from "@/hooks/useUserData";
// import { useServiceRequestLogic } from "../hooks/useServiceRequestLogic";




// export const SelectServiceVendorList: React.FC = () => {
//     const { toast } = useToast();

//     const {role, user_id} = useUserData()
//     const [itemToDelete, setItemToDelete] = useState<ServiceRequests | null>(null);

//     const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
//         {
//             fields: ["name", "creation", "project", "service_category_list", "status", "service_order_list", 'owner'], // Explicitly list needed fields
//             filters: [["status", "in", ["Created", "Rejected", "Edit"]]],
//             limit: 10000,
//             orderBy: { field: "modified", order: "desc" }
//         });

//     const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
//         fields: ["name", "project_name"],
//         limit: 1000
//     }, "Projects");


//      // Use the custom hook for deletion logic
//      const { deleteServiceRequest, isDeleting } = useServiceRequestLogic({
//         onSuccess: (deletedSrName) => {
//             serviceListMutate();
//             setItemToDelete(null); 
//         },
//         onError: (error, srName) => {
//             console.error(`Error deleting SR ${srName} from table view:`, error);
//         }
//     });


//     useFrappeDocTypeEventListener("Service Requests", async () => {
//         await serviceListMutate();
//     });

//     const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects]);


//     // --- Column Definitions ---
//     const columns: ColumnDef<ServiceRequests>[] = useMemo(
//         () => [
//             {
//                 accessorKey: "name",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="SR #" />, // Shortened title
//                 cell: ({ row }) => {
//                     const data = row.original;
//                     const srName = row.getValue("name") as string;
//                     return (
//                         <div className="font-medium flex items-center gap-2">
//                             <Link className="underline hover:underline-offset-2" to={`${srName}?tab=choose-vendor`}>
//                                 {srName?.slice(-4)} {/* Display last 4 chars */}
//                             </Link>
//                             {/* Ensure service_order_list exists and has list property */}
//                             {data?.service_order_list?.list && (
//                                 <ItemsHoverCard order_list={data.service_order_list.list} isSR />
//                             )}
//                         </div>
//                     );
//                 }
//             },
//             {
//                 accessorKey: "creation",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
//                 cell: ({ row }) => <div className="font-medium">{formatDate(row.getValue("creation"))}</div>
//             },
//             {
//                 accessorKey: "project",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
//                 cell: ({ row }) => {
//                     const project = project_values.find(p => p.value === row.getValue("project"));
//                     return <div className="font-medium">{project?.label || row.getValue("project") || '--'}</div>; // Show ID if label not found
//                 },
//                 filterFn: (row, id, value) => value.includes(row.getValue(id)),
//             },
//             {
//                 accessorKey: "service_category_list",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
//                 cell: ({ row }) => {
//                     const categories = row.getValue("service_category_list") as { list: { name: string }[] } | null;
//                     return (
//                         <div className="flex flex-wrap gap-1 items-center justify-start max-w-[200px]"> {/* Allow wrapping */}
//                             {categories?.list?.map((obj, index) => <Badge key={index} variant="secondary" className="inline-block">{obj.name}</Badge>)}
//                         </div>
//                     );
//                 }
//             },
//             {
//                 accessorKey: "status",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
//                 cell: ({ row }) => {
//                     const status = row.getValue("status") as string;
//                     let variant: "red" | "yellow" | "orange" | "default" = "default";
//                     if (status === "Rejected") variant = "red";
//                     else if (status === "Created") variant = "yellow";
//                     else if (status === "Edit") variant = "orange";
//                     return <Badge variant={variant}>{status}</Badge>;
//                 }
//             },
//              // --- Add Delete Column ---
//             {
//                 id: 'actions', // Give it a unique ID
//                 header: 'Actions', // Header for the actions column
//                 cell: ({ row }) => {
//                     const serviceRequest = row.original;

//                     const canDelete = serviceRequest.owner === user_id || role === "Nirmaan Admin Profile";

//                     if (!canDelete) {
//                         return null; // Don't show button if not allowed
//                     }

//                     return (
//                         <Button
//                             variant="ghost" // Use ghost or destructive variant
//                             size="icon"
//                             className="text-red-600 hover:text-red-800"
//                             disabled={isDeleting}
//                             onClick={(e) => {
//                                 e.stopPropagation(); // Prevent row click events if any
//                                 setItemToDelete(serviceRequest);
//                             }}
//                             aria-label={`Delete Service Request ${serviceRequest.name}`}
//                         >
//                             <Trash2 className="h-4 w-4" />
//                         </Button>
//                     );
//                 },
//             },
//             // --- End Delete Column ---
//         ],
//         [project_values, role, user_id] // Removed service_list dependency as it triggers too many recalculations. State changes will handle updates.
//     );

//     // Error Handling (keep your existing logic)
//     if (service_list_error || projects_error) {
//         // ... your error logging and toast logic ...
//         return <div className="text-red-500 p-4">Error loading data. Please check console or contact support.</div>; // Basic error display
//     }

//     // Handler for the dialog confirmation
//     const handleConfirmDelete = () => {
//         if (itemToDelete) {
//             deleteServiceRequest(itemToDelete.name); // Call the hook's function
//         }
//     }

//     return (
//         <div className="flex-1 space-y-4 p-4"> {/* Added padding */}
//             {(projects_loading || service_list_loading) ? (<TableSkeleton />) : (
//                 <DataTable columns={columns} data={service_list || []} project_values={project_values} />
//             )}

//             {/* Render the Delete Confirmation Dialog */}
//             <SRDeleteConfirmationDialog
//                 open={!!itemToDelete}
//                 onOpenChange={() => setItemToDelete(null)}
//                 itemName={itemToDelete?.name}
//                 itemType="Service Request" // Specific type for this instance
//                 onConfirm={handleConfirmDelete}
//                 isDeleting={isDeleting}
//             />
//         </div>
//     );
// };

// export default SelectServiceVendorList;



import React, { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeContext, FrappeConfig, useFrappeDocTypeEventListener, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { Trash2 } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

// --- Constants ---
const DOCTYPE = 'Service Requests';
const URL_SYNC_KEY = 'sr_select_vendor'; // Unique key for this table instance

// --- Component ---
export const SelectServiceVendorList: React.FC = () => {
    const { toast } = useToast();
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
    const fieldsToFetch: (keyof ServiceRequests | 'name')[] = useMemo(() => [
        "name", "creation", "modified", "owner", "project",
        "service_category_list", "status", "service_order_list"
    ], []);

    // --- Global Search Fields ---
    const globalSearchFields = useMemo(() => [
        "name", "project", "status", "owner"
        // Add other relevant text fields from Service Request
    ], []);

     // --- Date Filter Columns ---
     const dateColumns = useMemo(() => ["creation", "modified"], []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ServiceRequests>[]>(() => [
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
                          <ItemsHoverCard order_list={Array.isArray(data.service_order_list?.list) ? data.service_order_list.list : []} isSR />
                        </div>
                    </div>
                );
            }, size: 150,
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
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
            accessorKey: "service_category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.getValue("service_category_list") as { list: {name : string}[] } | undefined;
                const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
                return (
                    <div className="flex flex-wrap gap-1 items-start justify-start max-w-[200px]">
                        {categoryItems.length > 0
                            ? categoryItems.map((obj) => <Badge key={obj.name} variant="secondary" className="text-xs">{obj.name}</Badge>)
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
            accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => {
                const status = row.getValue("status") as string;
                let variant: "red" | "yellow" | "orange" | "default" = "default";
                if (status === "Rejected") variant = "red";
                else if (status === "Created") variant = "yellow";
                else if (status === "Edit") variant = "orange";
                return <Badge variant={variant}>{status}</Badge>;
            }, size: 120, enableColumnFilter: true,
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
        },
    ], [projectOptions, userList, role, user_id]); // Dependencies

    // --- Faceted Filter Options ---
    const statusOptions = useMemo(() => [
        {label: "Created", value: "Created"},
        {label: "Rejected", value: "Rejected"},
        {label: "Edit", value: "Edit"},
    ], []);

    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        status: { title: "Status", options: statusOptions },
    }), [projectOptions, statusOptions]);

    // --- Use the Server Data Table Hook ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        globalFilter, setGlobalFilter,
        isItemSearchEnabled, toggleItemSearch, showItemSearchToggle,
        refetch,
    } = useServerDataTable<ServiceRequests>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        globalSearchFieldList: globalSearchFields,
        enableItemSearch: true,
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

    // --- Realtime Update Handling ---
    useFrappeDocTypeEventListener(DOCTYPE, (event) => {
        console.log(`Realtime event for ${DOCTYPE} (SelectServiceVendorList):`, event);
        
            refetch();
            toast({ title: "Service Requests list updated.", duration: 2000 });
        // Refetch if the updated doc status is one of the relevant statuses for this view
        // const relevantStatuses = ["Created", "Rejected", "Edit"];
        // if (event.doc && relevantStatuses.includes(event.doc.status)) {
        //      refetch();
        //      toast({ title: "Service Requests list updated.", duration: 2000 });
        // } else if (event.doctype === DOCTYPE && !event.doc?.status) { // General update, might be delete
        //     refetch();
        // }
    });


    // --- Combined Loading & Error States ---
    const isLoading = projectsLoading || userListLoading;
    const combinedError = projectsError || userError || listError;

    if (combinedError) {
        toast({ title: "Error loading data", description: combinedError.message, variant: "destructive" });
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
                    globalFilterValue={globalFilter}
                    onGlobalFilterChange={setGlobalFilter}
                    searchPlaceholder="Search Service Requests..."
                    showItemSearchToggle={showItemSearchToggle} // Enable if item search is configured for SR
                    itemSearchConfig={{
                        isEnabled: isItemSearchEnabled,
                        toggle: toggleItemSearch,
                        label: "Service Item Search"
                    }}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
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