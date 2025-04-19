import React, { useState, useMemo, useCallback } from "react"; // Import useState and useCallback
import { Link } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeDocTypeEventListener, useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk"; // Import useFrappeDeleteDoc
import { Trash2 } from 'lucide-react'; // Import Trash2 icon

// Your existing imports
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { formatDate } from "@/utils/FormatDate";
import { SRDeleteConfirmationDialog } from "../components/SRDeleteConfirmationDialog";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { useServiceRequestLogic } from "../hooks/useServiceRequestLogic";




export const SelectServiceVendorList: React.FC = () => {
    const { toast } = useToast();

    const {role, user_id} = useUserData()
    const [itemToDelete, setItemToDelete] = useState<ServiceRequests | null>(null);

    const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
        {
            fields: ["name", "creation", "project", "service_category_list", "status", "service_order_list", 'owner'], // Explicitly list needed fields
            filters: [["status", "in", ["Created", "Rejected", "Edit"]]],
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    }, "Projects");


     // Use the custom hook for deletion logic
     const { deleteServiceRequest, isDeleting } = useServiceRequestLogic({
        onSuccess: (deletedSrName) => {
            serviceListMutate();
            setItemToDelete(null); 
        },
        onError: (error, srName) => {
            console.error(`Error deleting SR ${srName} from table view:`, error);
        }
    });


    useFrappeDocTypeEventListener("Service Requests", async () => {
        await serviceListMutate();
    });

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects]);


    // --- Column Definitions ---
    const columns: ColumnDef<ServiceRequests>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => <DataTableColumnHeader column={column} title="SR #" />, // Shortened title
                cell: ({ row }) => {
                    const data = row.original;
                    const srName = row.getValue("name") as string;
                    return (
                        <div className="font-medium flex items-center gap-2">
                            <Link className="underline hover:underline-offset-2" to={`${srName}?tab=choose-vendor`}>
                                {srName?.slice(-4)} {/* Display last 4 chars */}
                            </Link>
                            {/* Ensure service_order_list exists and has list property */}
                            {data?.service_order_list?.list && (
                                <ItemsHoverCard order_list={data.service_order_list.list} isSR />
                            )}
                        </div>
                    );
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
                cell: ({ row }) => <div className="font-medium">{formatDate(row.getValue("creation"))}</div>
            },
            {
                accessorKey: "project",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                cell: ({ row }) => {
                    const project = project_values.find(p => p.value === row.getValue("project"));
                    return <div className="font-medium">{project?.label || row.getValue("project") || '--'}</div>; // Show ID if label not found
                },
                filterFn: (row, id, value) => value.includes(row.getValue(id)),
            },
            {
                accessorKey: "service_category_list",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
                cell: ({ row }) => {
                    const categories = row.getValue("service_category_list") as { list: { name: string }[] } | null;
                    return (
                        <div className="flex flex-wrap gap-1 items-center justify-start max-w-[200px]"> {/* Allow wrapping */}
                            {categories?.list?.map((obj, index) => <Badge key={index} variant="secondary" className="inline-block">{obj.name}</Badge>)}
                        </div>
                    );
                }
            },
            {
                accessorKey: "status",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => {
                    const status = row.getValue("status") as string;
                    let variant: "red" | "yellow" | "orange" | "default" = "default";
                    if (status === "Rejected") variant = "red";
                    else if (status === "Created") variant = "yellow";
                    else if (status === "Edit") variant = "orange";
                    return <Badge variant={variant}>{status}</Badge>;
                }
            },
             // --- Add Delete Column ---
            {
                id: 'actions', // Give it a unique ID
                header: 'Actions', // Header for the actions column
                cell: ({ row }) => {
                    const serviceRequest = row.original;

                    const canDelete = serviceRequest.owner === user_id || role === "Nirmaan Admin Profile";

                    if (!canDelete) {
                        return null; // Don't show button if not allowed
                    }

                    return (
                        <Button
                            variant="ghost" // Use ghost or destructive variant
                            size="icon"
                            className="text-red-600 hover:text-red-800"
                            disabled={isDeleting}
                            onClick={(e) => {
                                e.stopPropagation(); // Prevent row click events if any
                                setItemToDelete(serviceRequest);
                            }}
                            aria-label={`Delete Service Request ${serviceRequest.name}`}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    );
                },
            },
            // --- End Delete Column ---
        ],
        [project_values, role, user_id] // Removed service_list dependency as it triggers too many recalculations. State changes will handle updates.
    );

    // Error Handling (keep your existing logic)
    if (service_list_error || projects_error) {
        // ... your error logging and toast logic ...
        return <div className="text-red-500 p-4">Error loading data. Please check console or contact support.</div>; // Basic error display
    }

    // Handler for the dialog confirmation
    const handleConfirmDelete = () => {
        if (itemToDelete) {
            deleteServiceRequest(itemToDelete.name); // Call the hook's function
        }
    }

    return (
        <div className="flex-1 space-y-4 p-4"> {/* Added padding */}
            {(projects_loading || service_list_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={service_list || []} project_values={project_values} />
            )}

            {/* Render the Delete Confirmation Dialog */}
            <SRDeleteConfirmationDialog
                open={!!itemToDelete}
                onOpenChange={() => setItemToDelete(null)}
                itemName={itemToDelete?.name}
                itemType="Service Request" // Specific type for this instance
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
            />
        </div>
    );
};

export default SelectServiceVendorList;