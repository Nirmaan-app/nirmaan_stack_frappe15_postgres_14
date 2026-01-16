import React, { useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, FileText, Pencil } from "lucide-react";
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { 
    useReactTable, 
    getCoreRowModel, 
    getSortedRowModel,
    ColumnDef,
} from "@tanstack/react-table";
import { RejectTDSModal } from "./components/RejectTDSModal";
import { ProjectEditTDSItemModal } from "./components/ProjectEditTDSItemModal";
import { toast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";

// Design tokens from screenshots
const COLORS = {
    primaryRed: "#D32F2F",
    pendingBg: "#FFF4CC",
    pendingText: "#9A6700",
    approvedBg: "#E6F4EA",
    approvedText: "#1E7F43",
    rejectedBg: "#FDECEA",
    rejectedText: "#B42318",
    inProgressBg: "#FFF4CC",
    inProgressText: "#9A6700",
    pillBorder: "#E5E7EB",
    paBg: "#E0F2FE",
    paText: "#0369A1",
    prBg: "#FFEDD5",
    prText: "#C2410C",
    arBg: "#F3E8FF",
    arText: "#7E22CE",
    parBg: "#F1F5F9",
    parText: "#334155",
};

interface TDSItem {
    name: string;
    tds_request_id: string;
    tdsi_project_name: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_attachment?: string;
    tds_status: string;
    owner: string;
    creation: string;
}

// Format date as "27th Nov, 2025"
const formatDateOrdinal = (dateStr: string) => {
    if (!dateStr) return "--";
    const date = new Date(dateStr);
    const day = date.getDate();
    const suffix = day === 1 || day === 21 || day === 31 ? "st" 
                 : day === 2 || day === 22 ? "nd"
                 : day === 3 || day === 23 ? "rd" 
                 : "th";
    return `${day}${suffix} ${format(date, "MMM, yyyy")}`;
};

// Status Badge Component
const StatusBadge = ({ status }: { status: string }) => {
    let bgColor = COLORS.inProgressBg;
    let textColor = COLORS.inProgressText;
    let label = status;
    
    if (status === "Approved") {
        bgColor = COLORS.approvedBg;
        textColor = COLORS.approvedText;
    } else if (status === "Rejected") {
        bgColor = COLORS.rejectedBg;
        textColor = COLORS.rejectedText;
    } else if (status === "Pending") {
        label = "Pending";
    } else if (status === "PA") {
        bgColor = COLORS.paBg;
        textColor = COLORS.paText;
    } else if (status === "PR") {
        bgColor = COLORS.prBg;
        textColor = COLORS.prText;
    } else if (status === "AR") {
        bgColor = COLORS.arBg;
        textColor = COLORS.arText;
    } else if (status === "PAR") {
        bgColor = COLORS.parBg;
        textColor = COLORS.parText;
    }
    
    return (
        <span 
            className="px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: bgColor, color: textColor }}
        >
            {label}
        </span>
    );
};

// Items Pill Component
const ItemsPill = ({ count }: { count: number }) => (
    <span 
        className="px-3 py-1 rounded-full text-sm font-medium bg-white border"
        style={{ borderColor: COLORS.pillBorder }}
    >
        {count} Items
    </span>
);

// Make Pill Component
const MakePill = ({ make }: { make: string }) => (
    <span 
        className="px-2 py-0.5 rounded text-xs font-medium bg-gray-50 border"
        style={{ borderColor: COLORS.pillBorder }}
    >
        {make}
    </span>
);

// Section Table Component
const ItemsTable = ({ 
    data, 
    columns, 
    showHeader = true,
    emptyMessage = "No items"
}: { 
    data: TDSItem[]; 
    columns: ColumnDef<TDSItem>[]; 
    showHeader?: boolean;
    emptyMessage?: string;
}) => {
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    return (
        <table className="w-full">
            {showHeader && (
                <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                        {table.getHeaderGroups()[0]?.headers.map(header => (
                            <th 
                                key={header.id} 
                                className="px-4 py-3 text-left text-sm font-medium text-gray-600"
                                style={{ width: header.column.getSize() }}
                            >
                                {header.isPlaceholder ? null : (
                                    typeof header.column.columnDef.header === 'function' 
                                        ? header.column.columnDef.header(header.getContext())
                                        : header.column.columnDef.header
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
            )}
            <tbody>
                {table.getRowModel().rows.length === 0 ? (
                    <tr>
                        <td colSpan={columns.length} className="text-center py-6 text-gray-400">
                            {emptyMessage}
                        </td>
                    </tr>
                ) : (
                    table.getRowModel().rows.map(row => (
                        <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                            {row.getVisibleCells().map(cell => (
                                <td key={cell.id} className="px-4 py-3 text-sm">
                                    {typeof cell.column.columnDef.cell === 'function'
                                        ? cell.column.columnDef.cell(cell.getContext())
                                        : cell.getValue() as string
                                    }
                                </td>
                            ))}
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    );
};

export const TDSApprovalDetail: React.FC = () => {
    const { id: requestId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const statusFilter = searchParams.get("status"); // "Pending", "Approved", "Rejected", or "All"
    const showAllSections = statusFilter === "All";

    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<TDSItem | null>(null);
    const [processing, setProcessing] = useState(false);

    // Fetch items for this request ID
    const { data: allItems, isLoading, mutate } = useFrappeGetDocList<TDSItem>("Project TDS Item List", {
        fields: ["*"],
        filters: [["tds_request_id", "=", requestId ?? ""]], 
        limit: 1000
    });
    
    // Split items by status
    const pendingItems = useMemo(() => 
        (allItems || []).filter(item => !item.tds_status || item.tds_status === "Pending"), 
    [allItems]);
    
    const approvedItems = useMemo(() => 
        (allItems || []).filter(item => item.tds_status === "Approved"), 
    [allItems]);
    
    const rejectedItems = useMemo(() => 
        (allItems || []).filter(item => item.tds_status === "Rejected"), 
    [allItems]);

    const { updateDoc } = useFrappeUpdateDoc();
    const { deleteDoc } = useFrappeDeleteDoc();

    // Derived Header Info
    const headerInfo = useMemo(() => {
        if (!allItems || allItems.length === 0) return null;
        const first = allItems[0];
        
        // Determine overall status based on combinations
        let overallStatus = "Pending";
        const p = pendingItems.length > 0;
        const a = approvedItems.length > 0;
        const r = rejectedItems.length > 0;

        if (p && a && r) overallStatus = "PAR";
        else if (p && a) overallStatus = "PA";
        else if (p && r) overallStatus = "PR";
        else if (a && r) overallStatus = "AR";
        else if (p) overallStatus = "Pending";
        else if (r) overallStatus = "Rejected";
        else if (a) overallStatus = "Approved";

        return {
            request_id: first.tds_request_id,
            project: first.tdsi_project_name,
            created_by: first.owner,
            creation: first.creation,
            count: allItems.length,
            status: overallStatus,
            pendingCount: pendingItems.length,
            approvedCount: approvedItems.length,
            rejectedCount: rejectedItems.length,
        };
    }, [allItems, pendingItems, approvedItems, rejectedItems]);

    const selectedCount = Object.keys(rowSelection).filter(k => rowSelection[k]).length;

    // Pending items columns (with checkbox and actions)
    const pendingColumns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            id: "select",
            header: () => null,
            cell: ({ row }) => (
                <Checkbox
                    checked={rowSelection[row.id] || false}
                    onCheckedChange={(value) => {
                        setRowSelection(prev => ({
                            ...prev,
                            [row.id]: !!value
                        }));
                    }}
                />
            ),
            enableSorting: false,
            size: 40,
        },
        {
            accessorKey: "tds_work_package",
            header: "Work Package",
            size: 150,
        },
        {
            accessorKey: "tds_category",
            header: "Category",
            size: 180,
        },
        {
            accessorKey: "tds_item_name",
            header: "Item Name",
            size: 180,
        },
        {
            accessorKey: "tds_description",
            header: "Description",
            cell: ({ row }) => (
                <div 
                    className="truncate max-w-[200px] text-gray-500" 
                    title={row.original.tds_description}
                >
                    {row.original.tds_description || "--"}
                </div>
            ),
            size: 200,
        },
        {
            accessorKey: "tds_make",
            header: "Make",
            cell: ({ row }) => <MakePill make={row.original.tds_make} />,
            size: 100,
        },
        {
            id: "doc",
            header: "Doc.",
            cell: ({ row }) => (
                row.original.tds_attachment ? (
                    <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(row.original.tds_attachment, '_blank')}
                    >
                        <FileText className="h-4 w-4 text-gray-500" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                        <FileText className="h-4 w-4 text-gray-300" />
                    </Button>
                )
            ),
            size: 60,
        },
        {
            id: "actions",
            header: "Actions",
            cell: ({ row }) => (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={() => {
                        setEditingItem(row.original);
                        setIsEditModalOpen(true);
                    }}
                >
                    <Pencil className="h-4 w-4" style={{ color: COLORS.primaryRed }} />
                </Button>
            ),
            size: 60,
        },
    ], [rowSelection]);

    // Read-only columns for Approved/Rejected sections
    const readOnlyColumns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            accessorKey: "tds_work_package",
            header: "Work Package",
            size: 150,
        },
        {
            accessorKey: "tds_category",
            header: "Category",
            size: 180,
        },
        {
            accessorKey: "tds_item_name",
            header: "Item Name",
            size: 180,
        },
        {
            accessorKey: "tds_description",
            header: "Description",
            cell: ({ row }) => (
                <div 
                    className="truncate max-w-[200px] text-gray-500" 
                    title={row.original.tds_description}
                >
                    {row.original.tds_description || "--"}
                </div>
            ),
            size: 200,
        },
        {
            accessorKey: "tds_make",
            header: "Make",
            cell: ({ row }) => <MakePill make={row.original.tds_make} />,
            size: 100,
        },
        {
            id: "doc",
            header: "Doc.",
            cell: ({ row }) => (
                row.original.tds_attachment ? (
                    <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(row.original.tds_attachment, '_blank')}
                    >
                        <FileText className="h-4 w-4 text-gray-500" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                        <FileText className="h-4 w-4 text-gray-300" />
                    </Button>
                )
            ),
            size: 60,
        },
    ], []);

    const handleApprove = async () => {
        const selectedItems = pendingItems.filter((_, index) => rowSelection[index.toString()]);

        if (selectedItems.length === 0) {
            toast({ title: "No items selected", variant: "destructive" });
            return;
        }

        const willBeEmpty = selectedItems.length === pendingItems.length;

        setProcessing(true);
        try {
            await Promise.all(selectedItems.map(doc => 
                updateDoc("Project TDS Item List", doc.name, { tds_status: "Approved" })
            ));
            toast({ title: "Approved", description: `${selectedItems.length} items approved`, variant: "success" });
            
            if (willBeEmpty) {
                navigate("/tds-approval");
            } else {
                setRowSelection({});
                mutate();
            }
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to approve items", variant: "destructive" });
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = (remarks: string) => {
        const selectedItems = pendingItems.filter((_, index) => rowSelection[index.toString()]);
         
        if (selectedItems.length === 0) return;

        const willBeEmpty = selectedItems.length === pendingItems.length;

        setProcessing(true);
        Promise.all(selectedItems.map(doc => 
            updateDoc("Project TDS Item List", doc.name, { 
                tds_status: "Rejected",
                remarks: remarks
            })
        )).then(() => {
            toast({ title: "Rejected", description: `${selectedItems.length} items rejected`, variant: "success" });
            
            if (willBeEmpty) {
                navigate("/tds-approval");
            } else {
                setRowSelection({});
                mutate();
                setIsRejectModalOpen(false);
            }
        }).catch((e) => {
            console.error(e);
            toast({ title: "Error", description: "Failed to reject items", variant: "destructive" });
        }).finally(() => {
            setProcessing(false);
        });
    };

    const onRejectClick = () => {
        if (selectedCount === 0) {
            toast({ title: "No items selected", variant: "destructive" });
            return;
        }
        setIsRejectModalOpen(true);
    };

    const handleEditSave = async (itemName: string, updates: Partial<TDSItem>, itemsToDelete?: string[]) => {
        setProcessing(true);
        try {
            // Check if there are items to delete (resubmission logic)
            if (itemsToDelete && itemsToDelete.length > 0) {
                await Promise.all(itemsToDelete.map(name => deleteDoc("Project TDS Item List", name)));
            }

            await updateDoc("Project TDS Item List", itemName, updates);
            toast({ title: "Updated", description: "Item updated successfully", variant: "success" });
            setIsEditModalOpen(false);
            setEditingItem(null);
            mutate();
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to update item", variant: "destructive" });
        } finally {
            setProcessing(false);
        }
    };

    const handleSelectAll = () => {
        const allSelected = pendingItems.every((_, index) => rowSelection[index.toString()]);
        if (allSelected) {
            setRowSelection({});
        } else {
            const newSelection: Record<string, boolean> = {};
            pendingItems.forEach((_, index) => {
                newSelection[index.toString()] = true;
            });
            setRowSelection(newSelection);
        }
    };

    const allPendingSelected = pendingItems.length > 0 && 
        pendingItems.every((_, index) => rowSelection[index.toString()]);

    return (
        <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-gray-50 min-h-screen">
            {/* Header Card */}
            {headerInfo && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                    {/* Top Row: Project Name */}
                    <div className="mb-4">
                        <h1 
                            className="text-xl font-semibold"
                            style={{ color: COLORS.primaryRed }}
                        >
                            {headerInfo.project}
                        </h1>
                    </div>

                    {/* TDS ID + Status */}
                    <div className="flex items-center gap-3 mb-3">
                        <p className="text-sm text-gray-500">
                            TDS ID: {headerInfo.request_id}
                        </p>
                        <StatusBadge status={headerInfo.status} />
                    </div>

                    {/* Metadata Row */}
                    <div className="flex items-center gap-8 text-sm">
                        <div>
                            <span className="text-gray-500">Created On: </span>
                            <span className="font-medium">{formatDateOrdinal(headerInfo.creation)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">Total Items:</span>
                            <ItemsPill count={headerInfo.count} />
                        </div>
                        <div>
                            <span className="text-gray-500">Created By: </span>
                            <span className="font-medium">{headerInfo.created_by}</span>
                        </div>
                    </div>
                </div>
            )}

            {isLoading ? (
                <div className="flex justify-center p-8 text-gray-500">Loading items...</div>
            ) : (
                <>
                    {/* PENDING SECTION - Show if All or Pending status */}
                    {(showAllSections || statusFilter === "Pending") && pendingItems.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-semibold">Pending Items</h2>
                                    <span 
                                        className="px-2.5 py-1 rounded-full text-xs font-medium"
                                        style={{ backgroundColor: COLORS.pendingBg, color: COLORS.pendingText }}
                                    >
                                        {pendingItems.length} Items
                                    </span>
                                    <span className="text-sm text-gray-500">
                                        {selectedCount}/{pendingItems.length} Selected
                                    </span>
                                </div>
                                <Button variant="outline" onClick={handleSelectAll}>
                                    {allPendingSelected ? "Deselect All" : "Select All"}
                                </Button>
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <ItemsTable 
                                    data={pendingItems} 
                                    columns={pendingColumns}
                                    emptyMessage="No pending items"
                                />
                                
                                {/* Action Buttons */}
                                <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
                                    <Button 
                                        variant="outline" 
                                        className="border-red-300 text-red-600 hover:bg-red-50"
                                        onClick={onRejectClick}
                                        disabled={selectedCount === 0 || processing}
                                    >
                                        <XCircle className="w-4 h-4 mr-2" /> Reject
                                    </Button>
                                    <Button 
                                        className="text-white"
                                        style={{ backgroundColor: COLORS.primaryRed }}
                                        onClick={handleApprove}
                                        disabled={selectedCount === 0 || processing}
                                    >
                                        <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* APPROVED SECTION - Show if All or Approved status */}
                    {(showAllSections || statusFilter === "Approved") && approvedItems.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold">Approved Items</h2>
                                <span 
                                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                                    style={{ backgroundColor: COLORS.approvedBg, color: COLORS.approvedText }}
                                >
                                    {approvedItems.length} Items
                                </span>
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <ItemsTable 
                                    data={approvedItems} 
                                    columns={readOnlyColumns}
                                    emptyMessage="No approved items"
                                />
                            </div>
                        </div>
                    )}

                    {/* REJECTED SECTION - Show if All or Rejected status */}
                    {(showAllSections || statusFilter === "Rejected") && rejectedItems.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold">Rejected Items</h2>
                                <span 
                                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                                    style={{ backgroundColor: COLORS.rejectedBg, color: COLORS.rejectedText }}
                                >
                                    {rejectedItems.length} Items
                                </span>
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <ItemsTable 
                                    data={rejectedItems} 
                                    columns={readOnlyColumns}
                                    emptyMessage="No rejected items"
                                />
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Back Button */}
            <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            
            <RejectTDSModal 
                open={isRejectModalOpen} 
                onOpenChange={setIsRejectModalOpen} 
                onConfirm={handleReject}
                loading={processing}
            />
            
            <ProjectEditTDSItemModal
                open={isEditModalOpen}
                onOpenChange={setIsEditModalOpen}
                item={editingItem}
                onSave={handleEditSave}
                loading={processing}
            />
        </div>
    );
};

export default TDSApprovalDetail;
