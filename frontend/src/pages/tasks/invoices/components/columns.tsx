// src/features/invoice-reconciliation/components/columns.tsx
import { ColumnDef } from "@tanstack/react-table";
import { Link } from 'react-router-dom';
import { InvoiceApprovalTask } from '@/types/NirmaanStack/Task'; // Adjust path
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"; // Adjust path
import { Badge } from "@/components/ui/badge"; // Adjust path
import { Button } from "@/components/ui/button"; // Adjust path
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"; // Adjust path
import { Check, X } from 'lucide-react'; // Adjust path
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice'; // Adjust path
import { formatDate } from 'date-fns'; // Use date-fns or your preferred library

// --- Helper function for common columns ---
const getCommonColumns = (): ColumnDef<InvoiceApprovalTask>[] => [
    {
        accessorKey: "task_docname",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Parent Doc" />,
        cell: ({ row }) => {
            const docType = row.original.task_doctype;
            const docName = row.original.task_docname
            const isPO = docType === "Procurement Orders"
            const linkDocName = isPO ? row.original.task_docname.replaceAll("/", "&=") : row.original.task_docname
            // IMPROVEMENT: Centralize route generation?
            const linkTo = docType === "Procurement Orders" ? `/purchase-orders/${linkDocName}?tab=Dispatched+PO` : `/service-requests/${linkDocName}?tab=approved-sr`;
            return (
                <TooltipProvider delayDuration={100}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Link to={linkTo} className="text-blue-600 hover:underline">
                                {docName}
                            </Link>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>View {docType === "Procurement Orders" ? "PO" : "SR"}: {docName}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        },
    },
    {
        accessorKey: "task_doctype",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
            <Badge variant={row.original.task_doctype === "Procurement Orders" ? "secondary" : "outline"}>
                {row.original.task_doctype === "Procurement Orders" ? "PO" : "SR"}
            </Badge>
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: "reference_value_2", // Invoice No
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No." />,
        cell: ({ row }) => <div className="font-medium">{row.original.reference_value_2 || 'N/A'}</div>,
    },
    {
        accessorKey: "reference_value_3", // Invoice Amount
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
            <div className="text-right">
                {formatToRoundedIndianRupee(parseFloat(row.original.reference_value_3 || '0'))}
            </div>
        ),
        sortingFn: 'alphanumeric', // Ensure correct numeric sorting
    },
    {
        accessorKey: "reference_value_1", // Invoice Date Key
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
        cell: ({ row }) => {
            const dateKey = row.original.reference_value_1 || '';
            const displayDate = dateKey.includes('_') ? dateKey.split('_')[0] : dateKey;
            try {
                return displayDate ? formatDate(new Date(displayDate), 'dd-MMM-yyyy') : 'N/A';
            } catch {
                return 'Invalid Date'; // Handle potential errors
            }
        },
        sortingFn: 'datetime', // Use datetime sorting
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Task Created" />,
        cell: ({ row }) => <div>{formatDate(new Date(row.original.creation), 'dd-MMM-yyyy HH:mm')}</div>,
        sortingFn: 'datetime',
    },
];

// --- Columns specific to Pending Tasks ---
export const getPendingTaskColumns = (
    openConfirmationDialog: (task: InvoiceApprovalTask, action: "Approved" | "Rejected") => void,
    loadingTaskId: string | null, // ID of the specific task being processed
    isProcessing: boolean // Flag if *any* task action is running
): ColumnDef<InvoiceApprovalTask>[] => [
    ...getCommonColumns(), // Include common columns
    {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
            const task = row.original;
            const isThisTaskLoading = loadingTaskId === task.name;

            return (
                <div className="flex items-center justify-end space-x-1">
                    {isThisTaskLoading ? (
                        <span className="px-2 text-xs text-muted-foreground">Processing...</span>
                        // Or use TailSpin here if preferred
                    ) : (
                        <>
                            <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="text-green-600 hover:bg-green-100 h-7 w-7"
                                            onClick={() => openConfirmationDialog(task, "Approved")}
                                            disabled={isProcessing} // Disable if any action is running
                                        >
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Approve Invoice</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="text-red-600 hover:bg-red-100 h-7 w-7"
                                            onClick={() => openConfirmationDialog(task, "Rejected")}
                                            disabled={isProcessing} // Disable if any action is running
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Reject Invoice</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </>
                    )}
                </div>
            );
        },
    },
];

// --- Columns specific to Task History ---
export const getTaskHistoryColumns = (getUserName: (id: string | undefined) => string): ColumnDef<InvoiceApprovalTask>[] => {

  return [
    ...getCommonColumns(), // Include common columns
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
             const status = row.original.status;
             let variant: "green" | "destructive" | "secondary" | "outline" | "warning" = "secondary"; // Use Badge variants
             if (status === 'Approved') variant = 'green';
             else if (status === 'Rejected') variant = 'destructive';
             else if (status === 'Pending') variant = 'outline';
             // Add others as needed
             return <Badge variant={variant}>{status}</Badge>;
        },
         filterFn: (row, id, value) => value.includes(row.getValue(id)), // Enable filtering by status
    },
    {
        accessorKey: "completed_by",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned By" />,
        cell: ({ row }) => <div>{row.original.status === "Pending" ? "N/A" : (getUserName(row.original.assignee) || 'Administrator')}</div>,
    },
    {
        accessorKey: "completion_date", // Or 'modified' if completion_date isn't reliable
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned Date" />,
        cell: ({ row }) => (
            <div>
                {row.original.status === "Pending" ? "N/A" : formatDate(new Date(row.original.modified), 'dd-MMM-yyyy HH:mm')
                    // 
                }
            </div>
        ),
         sortingFn: 'datetime',
    },
    // Add more history-specific columns if needed (e.g., rejection reason if captured)
]}