import React, { useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"; 
import { 
    useReactTable, 
    getCoreRowModel, 
    getFilteredRowModel, 
    getPaginationRowModel,
    getSortedRowModel,
    ColumnDef 
} from "@tanstack/react-table";
import { RejectTDSModal } from "./components/RejectTDSModal";
import { toast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";

interface TDSItem {
    name: string;
    tds_request_id: string; // Changed from request_id
    tdsi_project_name: string; // Changed from project
    tds_work_package: string; // Changed from work_package
    tds_category: string; // Changed from category
    tds_item_name: string;
    tds_description: string; // Changed from description
    tds_make: string; // Changed from make
    // quantity: number; // Removed as not in schema
    tds_status: string;
    owner: string;
    creation: string;
}

export const TDSApprovalDetail: React.FC = () => {
    const { id: requestId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const statusFilter = searchParams.get("status");

    const [rowSelection, setRowSelection] = useState({});
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Fetch items for this request ID
    const { data: allItems, isLoading, mutate } = useFrappeGetDocList<TDSItem>("Project TDS Item List", {
        fields: ["*"],
        filters: [["tds_request_id", "=", requestId]], 
        limit: 1000
    });
    
    // Filter items based on query param
    const items = useMemo(() => {
        if (!allItems) return [];
        if (!statusFilter || statusFilter === "All") return allItems;
        return allItems.filter(item => item.tds_status === statusFilter);
    }, [allItems, statusFilter]);

    const { updateDoc } = useFrappeUpdateDoc();

    // Derived Header Info (from first item of allItems to keep header consistent)
    const headerInfo = useMemo(() => {
        if (!allItems || allItems.length === 0) return null;
        const first = allItems[0];
        
        // Calculate overall status
        const hasRejected = allItems.some(i => i.tds_status === "Rejected");
        const hasPending = allItems.some(i => i.tds_status === "Pending");
        const status = hasRejected ? "Rejected" : (hasPending ? "Pending" : "Approved");

        return {
            request_id: first.tds_request_id,
            project: first.tdsi_project_name,
            created_by: first.owner,
            creation: first.creation,
            count: items.length,
            status: status
        };
    }, [items]);

    // Columns
    const columns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    disabled={row.original.tds_status !== "Pending"} 
                />
            ),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: "tds_item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
        },
        {
            accessorKey: "tds_work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
        },
        {
            accessorKey: "tds_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        },
        {
            accessorKey: "tds_description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => <div className="truncate max-w-[200px]" title={row.getValue("tds_description")}>{row.getValue("tds_description")}</div>
        },
        {
            accessorKey: "tds_make",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
        },
        // Quantity removed directly as field not present in schema
        {
            accessorKey: "tds_status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => {
                const status = row.getValue("tds_status") as string;
                let className = "bg-gray-100 text-gray-800";
                if(status === "Approved") className = "bg-green-100 text-green-800";
                if(status === "Rejected") className = "bg-red-100 text-red-800";
                return <Badge variant="secondary" className={className}>{status}</Badge>;
            }
        },
    ], []);

    const table = useReactTable({
        data: items || [],
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onRowSelectionChange: setRowSelection,
        state: {
            rowSelection,
        },
    });

    const handleApprove = async () => {
        const selectedIndices = Object.keys(rowSelection);
        if (selectedIndices.length === 0) {
            toast({ title: "No items selected", description: "Please select items to approve", variant: "destructive" });
            return;
        }
        
        const selectedDocs = table.getSelectedRowModel().rows.map(row => row.original);
        const pendingDocs = selectedDocs.filter(d => d.tds_status === "Pending");

        if (pendingDocs.length === 0) {
             toast({ title: "No Pending items", description: "Selected items are already processed", variant: "default" });
             return;
        }

        setProcessing(true);
        try {
            // Process sequentially or parallel
            await Promise.all(pendingDocs.map(doc => 
                updateDoc("Project TDS Item List", doc.name, { tds_status: "Approved" })
            ));
            toast({ title: "Approved", description: `${pendingDocs.length} items approved successfully`, variant: "success" });
            setRowSelection({}); // Clear selection
            mutate(); // Refetch
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to approve items", variant: "destructive" });
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = (remarks: string) => {
        // Logic to reject selected items
         const selectedDocs = table.getSelectedRowModel().rows.map(row => row.original);
         const pendingDocs = selectedDocs.filter(d => d.tds_status === "Pending");
         
         if (pendingDocs.length === 0) return;

         setProcessing(true);
         // Using Promise.all for now. Ideally a custom batch API would be better for atomicity.
         Promise.all(pendingDocs.map(doc => 
             updateDoc("Project TDS Item List", doc.name, { 
                 tds_status: "Rejected",
                 remarks: remarks // Assuming remarks field exists or needs to be added to doctype? 
                 // If "remarks" field exists in child table, good. If not, might need to store elsewhere.
                 // Assuming standard field "validation_remarks" or similar. Using "remarks" based on requirements.
             })
         )).then(() => {
             toast({ title: "Rejected", description: `${pendingDocs.length} items rejected`, variant: "success" });
             setRowSelection({});
             mutate();
             setIsRejectModalOpen(false);
         }).catch((e) => {
             console.error(e);
             toast({ title: "Error", description: "Failed to reject items", variant: "destructive" });
         }).finally(() => {
             setProcessing(false);
         });
    };

    const onRejectClick = () => {
        const selectedIndices = Object.keys(rowSelection);
        if (selectedIndices.length === 0) {
            toast({ title: "No items selected", variant: "destructive" });
            return;
        }
         const selectedDocs = table.getSelectedRowModel().rows.map(row => row.original);
         const pendingDocs = selectedDocs.filter(d => d.tds_status === "Pending");
          if (pendingDocs.length === 0) {
             toast({ title: "No Pending items", description: "Selected items are already processed", variant: "default" });
             return;
        }
        setIsRejectModalOpen(true);
    };

    return (
        <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <h2 className="text-2xl font-bold tracking-tight">TDS Request Details</h2>
            </div>

            {headerInfo && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                    <div>
                        <p className="text-sm text-gray-500">TDS ID</p>
                        <p className="font-medium">{headerInfo.request_id}</p>
                    </div>
                     <div>
                        <p className="text-sm text-gray-500">Project</p>
                        <p className="font-medium">{headerInfo.project}</p>
                    </div>
                     <div>
                        <p className="text-sm text-gray-500">Created By</p>
                         <p className="font-medium">{headerInfo.created_by}</p>
                    </div>
                     <div>
                        <p className="text-sm text-gray-500">Created On</p>
                         <p className="font-medium">{headerInfo.creation ? format(new Date(headerInfo.creation), "dd-MM-yyyy") : "--"}</p>
                    </div>
                     <div>
                        <p className="text-sm text-gray-500">Status</p>
                        <Badge variant="outline" className={
                             headerInfo.status === "Approved" ? "bg-green-100 text-green-800" :
                             headerInfo.status === "Rejected" ? "bg-red-100 text-red-800" :
                             "bg-yellow-100 text-yellow-800"
                        }>
                            {headerInfo.status}
                        </Badge>
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Items for TDS</h3>
                <div className="flex gap-2">
                     <div className="flex items-center gap-2 mr-4">
                        <Checkbox 
                            id="select-all"
                            checked={table.getIsAllPageRowsSelected()}
                            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                        />
                        <label htmlFor="select-all" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Select All
                        </label>
                    </div>
                    
                    <Button 
                        variant="destructive" 
                        onClick={onRejectClick}
                        disabled={Object.keys(rowSelection).length === 0 || processing}
                    >
                         <XCircle className="w-4 h-4 mr-2" /> Reject
                    </Button>
                    <Button 
                        variant="default" 
                        className="bg-green-600 hover:bg-green-700" 
                        onClick={handleApprove}
                         disabled={Object.keys(rowSelection).length === 0 || processing}
                    >
                         <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                    </Button>
                </div>
            </div>
            
            <Separator />
            
            {isLoading ? (
                <div className="flex justify-center p-8">Loading items...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {table.getRowModel().rows.map(row => (
                        <div 
                            key={row.id} 
                            className={`
                                relative p-4 rounded-lg border transition-all duration-200
                                ${row.getIsSelected() ? 'border-primary bg-primary/5' : 'border-gray-200 bg-white hover:border-gray-300'}
                            `}
                        >
                            <div className="absolute top-4 right-4 z-10">
                                <Checkbox
                                    checked={row.getIsSelected()}
                                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                                    disabled={row.original.tds_status !== "Pending"}
                                />
                            </div>

                            <div className="pr-8">
                                <div className="flex items-center justify-between mb-2">
                                     <h4 className="font-semibold text-sm truncate" title={row.original.tds_item_name}>
                                        {row.original.tds_item_name}
                                    </h4>
                                </div>
                                
                                <div className="space-y-1 text-sm text-gray-500">
                                    <div className="flex justify-between">
                                        <span>Work Package:</span>
                                        <span className="font-medium text-gray-900">{row.original.tds_work_package}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Category:</span>
                                        <span className="font-medium text-gray-900">{row.original.tds_category}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Make:</span>
                                        <span className="font-medium text-gray-900">{row.original.tds_make}</span>
                                    </div>
                                     <div className="flex justify-between items-center pt-2">
                                        <span>Status:</span>
                                        <Badge variant="secondary" className={
                                            row.original.tds_status === "Approved" ? "bg-green-100 text-green-800" :
                                            row.original.tds_status === "Rejected" ? "bg-red-100 text-red-800" :
                                            "bg-gray-100 text-gray-800"
                                        }>
                                            {row.original.tds_status}
                                        </Badge>
                                    </div>
                                </div>
                                
                                <div className="mt-3 text-xs text-gray-400 border-t pt-2">
                                    <p className="line-clamp-2" title={row.original.tds_description}>
                                        {row.original.tds_description || "No description"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                    
                    {(!items || items.length === 0) && (
                        <div className="col-span-full text-center py-10 text-gray-500">
                            No items found for this requests.
                        </div>
                    )}
                </div>
            )}
            
            <RejectTDSModal 
                open={isRejectModalOpen} 
                onOpenChange={setIsRejectModalOpen} 
                onConfirm={handleReject}
                loading={processing}
            />
        </div>
    );
};

export default TDSApprovalDetail;
