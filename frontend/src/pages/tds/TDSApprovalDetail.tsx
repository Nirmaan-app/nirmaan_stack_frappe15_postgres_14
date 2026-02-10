import React, { useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, FileText, Pencil, MessageSquare, Clock, User, Layers } from "lucide-react";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { 
    Tooltip, 
    TooltipContent, 
    TooltipProvider,
    TooltipTrigger 
} from "@/components/ui/tooltip";
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeUpdateDoc, useFrappeDeleteDoc } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TDSItem {
    name: string;
    tds_request_id: string;
    tdsi_project_id: string;
    tdsi_project_name: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_attachment?: string;
    tds_status: string;
    tds_rejection_reason?: string;
    owner: string;
    creation: string;
    tds_boq_line_item?: string;
}

// Format date as "27 Nov, 2025"
const formatDateClean = (dateStr: string) => {
    if (!dateStr) return "--";
    return format(new Date(dateStr), "dd MMM, yyyy");
};

// Enhanced Status Badge
const StatusBadge = ({ status }: { status: string }) => {
    let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let className = "font-medium border-0";
    let label = status;

    if (status === "Pending") {
        className += " bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20";
    } else if (status === "Approved") {
        className += " bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
    } else if (status === "Rejected") {
        className += " bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20";
    } else if (status === "PA") {
        className += " bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20";
    } else if (status === "PR") {
        className += " bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20";
    } else if (status === "AR") {
        className += " bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20";
    } else if (status === "PAR") {
        className += " bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-600/20";
    } else {
        className += " bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-400/20";
    }
    
    return <Badge variant={variant} className={className}>{label}</Badge>;
};

// Make Pill Component
const MakePill = ({ make }: { make: string }) => (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
        {make}
    </span>
);



// Section Table Component
const ItemsTable = ({ 
    data, 
    columns, 
    showHeader = true,
    emptyMessage = "No items",
    // Optional props for mobile selection
    onSelectionChange,
    rowSelection,
    enableSelection = false
}: { 
    data: TDSItem[]; 
    columns: ColumnDef<TDSItem>[]; 
    showHeader?: boolean;
    emptyMessage?: string;
    onSelectionChange?: (id: string, val: boolean) => void;
    rowSelection?: Record<string, boolean>;
    enableSelection?: boolean;
}) => {
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    return (
        <div className="w-full">
            {/* Desktop Table View */}
            <div className="hidden md:block w-full overflow-x-auto">
                <table className="w-full whitespace-nowrap">
                    {showHeader && (
                        <thead className="bg-slate-50/50 border-b border-gray-200">
                            <tr>
                                {table.getHeaderGroups()[0]?.headers.map(header => (
                                    <th 
                                        key={header.id} 
                                        className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
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
                                <td colSpan={columns.length} className="text-center py-8 text-gray-400 text-sm">
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map(row => (
                                <tr key={row.id} className="border-b border-gray-100 hover:bg-slate-50/50 transition-colors">
                                    {row.getVisibleCells().map(cell => (
                                        <td key={cell.id} className="px-4 py-3 text-sm text-slate-700">
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
            </div>

            {/* Mobile Card View ("Credit Card" Style) */}
            <div className="md:hidden flex flex-col gap-3 p-4 bg-slate-50/30">
                 {table.getRowModel().rows.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">{emptyMessage}</div>
                ) : (
                    table.getRowModel().rows.map(row => {
                        const item = row.original;
                        const isSelected = rowSelection ? rowSelection[row.id] : false;
                        
                        return (
                            <div 
                                key={row.id} 
                                className={`bg-white rounded-lg border p-3 shadow-sm transition-all ${isSelected ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-slate-200'}`}
                            >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex items-center gap-3">
                                        {enableSelection && onSelectionChange && (
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={(val) => onSelectionChange(row.id, !!val)}
                                                className="mt-0.5 rounded-sm border-slate-300 data-[state=checked]:bg-emerald-600"
                                            />
                                        )}
                                        <div>
                                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                                {item.tds_work_package}
                                            </div>
                                            <div className="font-medium text-slate-900 line-clamp-1">
                                                {item.tds_item_name}
                                            </div>
                                        </div>
                                    </div>
                                    <MakePill make={item.tds_make} />
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-2">
                                    <div>
                                        <span className="text-slate-400 mr-1">Cat:</span> 
                                        {item.tds_category}
                                    </div>
                                    {item.tds_attachment && (
                                        <div className="flex justify-end">
                                            <a 
                                                href={item.tds_attachment} 
                                                target="_blank" 
                                                rel="noreferrer"
                                                className="flex items-center gap-1 text-blue-600 hover:underline"
                                            >
                                                <FileText className="h-3 w-3" /> View Doc
                                            </a>
                                        </div>
                                    )}
                                </div>
                                
                                {item.tds_description && (
                                    <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-100 line-clamp-2">
                                        {item.tds_description}
                                    </div>
                                )}
                                
                                {item.tds_status === "Rejected" && item.tds_rejection_reason && (
                                     <div className="mt-2 text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100 flex items-start gap-1.5">
                                        <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{item.tds_rejection_reason}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
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

    // Use custom hook for user data and role
    const { user_id, role } = useUserData();

    const ALLOWED_APPROVER_ROLES = [
        "Nirmaan Admin Profile",
        "Nirmaan Project Lead Profile", 
        "Nirmaan PMO Executive Profile",
    ];

    const canApprove = user_id === "Administrator" || (!!role && ALLOWED_APPROVER_ROLES.includes(role));

    // Fetch items for this request ID
    const { data: allItems, isLoading, mutate } = useFrappeGetDocList<TDSItem>("Project TDS Item List", {
        fields: ["*"],
        filters: [["tds_request_id", "=", requestId ?? ""]],
        limit: 0
    });

    // CEO Hold guard - use project ID from first TDS item
    const projectId = allItems?.[0]?.tdsi_project_id;
    const { isCEOHold } = useCEOHoldGuard(projectId);

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

    // Fetch owner's full name from Nirmaan Users
    const ownerEmail = allItems?.[0]?.owner || '';
    const { data: ownerData } = useFrappeGetDoc<{ full_name: string }>(
        'Nirmaan Users', 
        ownerEmail,
        ownerEmail ? undefined : null
    );

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
            created_by: ownerData?.full_name || first.owner,
            creation: first.creation,
            count: allItems.length,
            status: overallStatus,
            pendingCount: pendingItems.length,
            approvedCount: approvedItems.length,
            rejectedCount: rejectedItems.length,
        };
    }, [allItems, pendingItems, approvedItems, rejectedItems, ownerData]);

    const selectedCount = Object.keys(rowSelection).filter(k => rowSelection[k]).length;

    // Helper for mobile selection
    const handleMobileSelectionChange = (id: string, val: boolean) => {
        setRowSelection(prev => ({
            ...prev,
            [id]: val
        }));
    };

    // Pending items columns (with checkbox and actions)
    const pendingColumns = useMemo<ColumnDef<TDSItem>[]>(() => {
        const cols: ColumnDef<TDSItem>[] = [];
        
        if (canApprove) {
            cols.push({
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
                        className="rounded-sm border-slate-300 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                    />
                ),
                enableSorting: false,
                size: 40,
            });
        }

        cols.push(
            {
                accessorKey: "tds_work_package",
                header: "Work Package",
                cell: ({ row }) => <span className="font-medium text-slate-700 whitespace-normal break-words">{row.getValue("tds_work_package")}</span>,
                size: 150,
            },
            {
                accessorKey: "tds_category",
                header: "Category",
                cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_category")}</span>,
                size: 180,
            },
            {
                accessorKey: "tds_item_name",
                header: "Item Name",
                cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_item_name")}</span>,
                size: 180,
            },
            {
                accessorKey: "tds_description",
                header: "Description",
                cell: ({ row }) => (
                    <div 
                        className="truncate max-w-[200px] text-slate-500" 
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
                accessorKey: "tds_boq_line_item",
                header: "BOQ Ref",
                cell: ({ row }) => {
                    const text = row.original.tds_boq_line_item;
                    
                    return (
                        <div className="flex justify-start items-center">
                            {text ? (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="cursor-pointer p-1 rounded-full hover:bg-slate-100">
                                                <MessageSquare className="h-4 w-4 text-blue-500 hover:text-blue-700" />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-[400px] whitespace-normal break-words z-50">
                                            <p>{text}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            ) : (
                                <span className="text-gray-300 ml-2">-</span>
                            )}
                        </div>
                    );
                },
                size: 100,
            },
            {
                id: "doc",
                header: "Doc",
                cell: ({ row }) => (
                    row.original.tds_attachment ? (
                        <Button 
                            variant="ghost" 
                            size="icon"
                            className="h-8 w-8 hover:bg-slate-100 text-slate-500"
                            onClick={() => window.open(row.original.tds_attachment, '_blank')}
                        >
                            <FileText className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed">
                            <FileText className="h-4 w-4 text-slate-400" />
                        </Button>
                    )
                ),
                size: 60,
            }
        );

        if (canApprove) {
            cols.push({
                id: "actions",
                header: "Actions",
                cell: ({ row }) => (
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 hover:bg-slate-100"
                        onClick={() => {
                            setEditingItem(row.original);
                            setIsEditModalOpen(true);
                        }}
                    >
                        <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                ),
                size: 60,
            });
        }

        return cols;
    }, [rowSelection, canApprove]);

    // Read-only columns for Approved/Rejected sections
    const readOnlyColumns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            accessorKey: "tds_work_package",
            header: "Work Package",
            cell: ({ row }) => <span className="font-medium text-slate-700 whitespace-normal break-words">{row.getValue("tds_work_package")}</span>,
            size: 150,
        },
        {
            accessorKey: "tds_category",
            header: "Category",
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_category")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_item_name",
            header: "Item Name",
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_item_name")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_description",
            header: "Description",
            cell: ({ row }) => (
                <div 
                    className="truncate max-w-[200px] text-slate-500" 
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
            accessorKey: "tds_boq_line_item",
            header: "BOQ Ref",
            cell: ({ row }) => {
                const text = row.original.tds_boq_line_item;
                
                return (
                    <div className="flex justify-start items-center">
                        {text ? (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="cursor-pointer p-1 rounded-full hover:bg-slate-100">
                                            <MessageSquare className="h-4 w-4 text-blue-500 hover:text-blue-700" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[400px] whitespace-normal break-words">
                                        <p>{text}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : (
                            <span className="text-gray-300 ml-2">-</span>
                        )}
                    </div>
                );
            },
            size: 100,
        },
        {
            id: "doc",
            header: "Doc",
            cell: ({ row }) => (
                row.original.tds_attachment ? (
                    <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 hover:bg-slate-100 text-slate-500"
                        onClick={() => window.open(row.original.tds_attachment, '_blank')}
                    >
                        <FileText className="h-4 w-4" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed">
                        <FileText className="h-4 w-4 text-slate-400" />
                    </Button>
                )
            ),
            size: 60,
        },
    ], []);

    // Rejected items columns (includes Reject Reason)
    const rejectedColumns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            accessorKey: "tds_work_package",
            header: "Work Package",
            cell: ({ row }) => <span className="font-medium text-slate-700 whitespace-normal break-words">{row.getValue("tds_work_package")}</span>,
            size: 150,
        },
        {
            accessorKey: "tds_category",
            header: "Category",
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_category")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_item_name",
            header: "Item Name",
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_item_name")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_description",
            header: "Description",
            cell: ({ row }) => (
                <div 
                    className="truncate max-w-[150px] text-slate-500" 
                    title={row.original.tds_description}
                >
                    {row.original.tds_description || "--"}
                </div>
            ),
            size: 150,
        },
        {
            accessorKey: "tds_make",
            header: "Make",
            cell: ({ row }) => <MakePill make={row.original.tds_make} />,
            size: 100,
        },
        {
            accessorKey: "tds_boq_line_item",
            header: "BOQ Ref",
            cell: ({ row }) => {
                const text = row.original.tds_boq_line_item;
                
                return (
                    <div className="flex justify-start items-center">
                        {text ? (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="cursor-pointer p-1 rounded-full hover:bg-slate-100">
                                            <MessageSquare className="h-4 w-4 text-blue-500 hover:text-blue-700" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[400px] whitespace-normal break-words">
                                        <p>{text}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : (
                            <span className="text-gray-300 ml-2">-</span>
                        )}
                    </div>
                );
            },
            size: 100,
        },
        {
            accessorKey: "tds_rejection_reason",
            header: "Reason",
            cell: ({ row }) => {
                const reason = row.original.tds_rejection_reason;
                const hasReason = !!reason && reason.trim() !== "";
                
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex justify-start items-center cursor-help">
                                    <MessageSquare 
                                        className={`h-4 w-4 ${hasReason ? "text-rose-500 hover:text-rose-700" : "text-gray-300 opacity-40"} transition-colors`} 
                                    />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{hasReason ? reason : "No reason provided"}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
            size: 60,
        },
        {
            id: "doc",
            header: "Doc",
            cell: ({ row }) => (
                row.original.tds_attachment ? (
                    <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 hover:bg-slate-100 text-slate-500"
                        onClick={() => window.open(row.original.tds_attachment, '_blank')}
                    >
                        <FileText className="h-4 w-4" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed">
                        <FileText className="h-4 w-4 text-slate-400" />
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
                tds_rejection_reason: remarks
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
        <div className="flex-1 space-y-4 md:space-y-6 p-2 md:p-4 bg-slate-50/50 min-h-screen">
            {isCEOHold && <CEOHoldBanner className="mb-4" />}
            {/* Breadcrumb Header */}
            <div className="flex flex-col space-y-2">
                {/* <Button
                    variant="ghost"
                    onClick={() => navigate(-1)}
                    className="w-fit -ml-2 text-slate-500 hover:text-slate-900"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back to List
                </Button>
                 */}
                {headerInfo && (
                    <Card className="border-l-4 border-l-red-500 shadow-sm border border-slate-200 bg-white">
                        <CardContent className="p-3 md:p-4">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                                            {headerInfo.project}
                                        </h1>
                                        <div className="flex items-center flex-wrap gap-2 text-sm text-slate-600 mt-1">
                                            <span className="flex items-center gap-2 font-medium text-red-600">
                                                <FileText className="h-3.5 w-3.5" />
                                                <span className="hidden md:inline">Request ID:</span>
                                                <span>#{headerInfo.request_id}</span>
                                            </span>
                                            <span className="text-slate-300 mx-1">|</span>
                                            <span className="flex items-center gap-1.5">
                                                <User className="h-3.5 w-3.5 text-slate-400" />
                                                <span className="hidden md:inline text-slate-500">Created By:</span>
                                                <span className="font-medium text-slate-900">{headerInfo.created_by}</span>
                                            </span>
                                            <span className="text-slate-300 mx-1">|</span>
                                            <span className="flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                                <span className="hidden md:inline text-slate-500">Created Date:</span>
                                                <span className="font-medium text-slate-900">{formatDateClean(headerInfo.creation)}</span>
                                            </span>
                                            <span className="text-slate-300 mx-1">|</span>
                                            <span className="flex items-center gap-1.5">
                                                <Layers className="h-3.5 w-3.5 text-slate-400" />
                                                <span className="hidden md:inline text-slate-500">Total Items:</span>
                                                <span className="font-medium text-slate-900">{headerInfo.count}</span>
                                                <span className="md:hidden font-medium text-slate-900">Items</span>
                                            </span>
                                        </div>
                                    </div>
                                    <StatusBadge status={headerInfo.status} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center p-12 text-slate-400 animate-pulse">Loading details...</div>
            ) : (
                <div className="space-y-8">
                    {/* PENDING SECTION - Priority View */}
                    {(showAllSections || statusFilter === "Pending") && pendingItems.length > 0 && (
                        <Card className="border-amber-200/50 shadow-sm ring-1 ring-amber-100/50">
                            <CardHeader className="bg-amber-50/50 border-b border-amber-100/50 px-3 py-3 md:px-6 md:py-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <CardTitle className="text-lg font-semibold text-amber-900">Pending Review</CardTitle>
                                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                                            {pendingItems.length}
                                        </Badge>
                                    </div>
                                    {canApprove && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-amber-700 font-medium mr-2">
                                                {selectedCount} selected
                                            </span>
                                            <Button 
                                                variant="outline" 
                                                size="sm"
                                                onClick={handleSelectAll}
                                                className="h-8 border-amber-200 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                                            >
                                                {allPendingSelected ? "Deselect All" : "Select All"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </CardHeader>
                            <div className="p-0">
                                <ItemsTable 
                                    data={pendingItems} 
                                    columns={pendingColumns}
                                    emptyMessage="No pending items"
                                    onSelectionChange={handleMobileSelectionChange}
                                    rowSelection={rowSelection}
                                    enableSelection={canApprove}
                                />
                            </div>
                            
                            {/* Sticky Action Footer for Pending Items */}
                            {canApprove && pendingItems.length > 0 && (
                                <div className="px-3 py-3 md:px-6 md:py-4 bg-amber-50/30 border-t border-amber-100/50 flex flex-col-reverse sm:flex-row justify-end gap-3 rounded-b-lg">
                                    <Button 
                                        variant="outline" 
                                        className="w-full sm:w-auto border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                        onClick={onRejectClick}
                                        disabled={selectedCount === 0 || processing}
                                    >
                                        <XCircle className="w-4 h-4 mr-2" /> Reject Selected
                                    </Button>
                                    <Button 
                                        className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                        onClick={handleApprove}
                                        disabled={selectedCount === 0 || processing}
                                    >
                                        <CheckCircle2 className="w-4 h-4 mr-2" /> Approve Selected
                                    </Button>
                                </div>
                            )}
                        </Card>
                    )}

                    {/* APPROVED SECTION */}
                    {(showAllSections || statusFilter === "Approved") && approvedItems.length > 0 && (
                        <Card className="border-emerald-200/50 shadow-sm ring-1 ring-emerald-100/50">
                            <CardHeader className="bg-emerald-50/50 border-b border-emerald-100/50 px-3 py-3 md:px-6 md:py-4">
                                <div className="flex items-center gap-3">
                                    <CardTitle className="text-lg font-semibold text-emerald-900">Approved Items</CardTitle>
                                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                        {approvedItems.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <div className="p-0">
                                <ItemsTable 
                                    data={approvedItems} 
                                    columns={readOnlyColumns}
                                    emptyMessage="No approved items"
                                />
                            </div>
                        </Card>
                    )}

                    {/* REJECTED SECTION */}
                    {(showAllSections || statusFilter === "Rejected") && rejectedItems.length > 0 && (
                        <Card className="border-rose-200/50 shadow-sm ring-1 ring-rose-100/50">
                            <CardHeader className="bg-rose-50/50 border-b border-rose-100/50 px-3 py-3 md:px-6 md:py-4">
                                <div className="flex items-center gap-3">
                                    <CardTitle className="text-lg font-semibold text-rose-900">Rejected Items</CardTitle>
                                    <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100">
                                        {rejectedItems.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <div className="p-0">
                                <ItemsTable 
                                    data={rejectedItems} 
                                    columns={rejectedColumns}
                                    emptyMessage="No rejected items"
                                />
                            </div>
                        </Card>
                    )}
                </div>
            )}

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
            />
        </div>
    );
};

export default TDSApprovalDetail;
