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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import SITEURL from "@/constants/siteURL";

// --- Helper function for common columns ---
const getCommonColumns = (attachmentsMap?: Record<string, string>): ColumnDef<InvoiceApprovalTask>[] => [
    {
        accessorKey: "task_docname",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Parent Doc" />,
        cell: ({ row }) => {
            const docType = row.original.task_doctype;
            const docName = row.original.task_docname;
            const isPO = docType === "Procurement Orders";
            const linkDocName = isPO ? row.original.task_docname.replaceAll("/", "&=") : row.original.task_docname;
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
        meta: {
            exportHeaderName: "Parent Doc",
            exportValue: (row) => {
                return row.task_docname;
            }
        }
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
        meta: {
            exportHeaderName: "Type",
            exportValue: (row) => {
                return row.task_doctype === "Procurement Orders" ? "PO" : "SR";
            }
        }
    },
    {
        accessorKey: "reference_value_2", // Invoice No
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No." />,
        // cell: ({ row }) => <div className="font-medium">{row.original.reference_value_2 || 'N/A'}</div>,
        cell: ({ row }) => {
            const invoice_no = row.original.reference_value_2;
            const attachmentId = row.original.reference_value_4;
            return (
                attachmentId ? (
                    <div className="font-medium text-blue-500">
                        <HoverCard>
                            <HoverCardTrigger onClick={() => window.open(`${SITEURL}${attachmentsMap?.[attachmentId]}`, '_blank')}>
                                {invoice_no}
                            </HoverCardTrigger>
                            <HoverCardContent className="w-auto rounded-md shadow-lg">
                                <img
                                    src={`${SITEURL}${attachmentsMap?.[attachmentId]}`}
                                    alt="Payment Screenshot"
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                />
                            </HoverCardContent>
                        </HoverCard>
                    </div>
                ) : (
                    <div className="font-medium">
                        {invoice_no}
                    </div>
                )
            );
        },
        meta: {
            exportHeaderName: "Invoice No.",
            exportValue: (row) => {
                return row.reference_value_2;
            }
        }

    },
    {
        accessorKey: "reference_value_3", // Invoice Amount
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
            <div className="">
                {formatToRoundedIndianRupee(parseFloat(row.original.reference_value_3 || '0'))}
            </div>
        ),
        sortingFn: 'alphanumeric', // Ensure correct numeric sorting
        meta: {
            exportHeaderName: "Invoice Amount",
            exportValue: (row) => {
                return row.reference_value_3;
            }
        }
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
        meta: {
            exportHeaderName: "Invoice Date",
            exportValue: (row) => {
                const dateKey = row.reference_value_1 || '';
                const displayDate = dateKey.includes('_') ? dateKey.split('_')[0] : dateKey;
                return displayDate;
            }
        }
    },
    {
        accessorKey: "creation",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Task Created" />,
        cell: ({ row }) => <div>{formatDate(new Date(row.original.creation), 'dd-MMM-yyyy HH:mm')}</div>,
        sortingFn: 'datetime',
        meta: {
            exportHeaderName: "Task Created",
            exportValue: (row) => {
                return formatDate(new Date(row.creation), 'dd-MMM-yyyy HH:mm')
            }
        }
    },
];

// --- Columns specific to Pending Tasks ---
export const getPendingTaskColumns = (
    openConfirmationDialog: (task: InvoiceApprovalTask, action: "Approved" | "Rejected") => void,
    loadingTaskId: string | null, // ID of the specific task being processed
    isProcessing: boolean, // Flag if *any* task action is running
    attachmentsMap?: Record<string, string>
): ColumnDef<InvoiceApprovalTask>[] => [
        ...getCommonColumns(attachmentsMap), // Include common columns
        {
            id: "actions",
            header: () => <div className="">Actions</div>,
            cell: ({ row }) => {
                const task = row.original;
                const isThisTaskLoading = loadingTaskId === task.name;

                return (
                    <div className="flex items-center space-x-1">
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
export const getTaskHistoryColumns = (getUserName: (id: string | undefined) => string, attachmentsMap?: Record<string, string>): ColumnDef<InvoiceApprovalTask>[] => {

    return [
        ...getCommonColumns(attachmentsMap), // Include common columns
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
            meta: {
                exportHeaderName: "Status",
                exportValue: (row) => {
                    return row.status;
                }
            }
        },
        {
            accessorKey: "assignee",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned By" />,
            cell: ({ row }) => <div>{row.original.status === "Pending" ? "N/A" : (getUserName(row.original.assignee) || 'Administrator')}</div>,
            meta: {
                exportHeaderName: "Actioned By",
                exportValue: (row) => {
                    return getUserName(row.assignee) || 'Administrator';
                }
            }
        },
        {
            accessorKey: "modified", // Or 'modified' if completion_date isn't reliable
            header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned Date" />,
            cell: ({ row }) => (
                <div>
                    {row.original.status === "Pending" ? "N/A" : formatDate(new Date(row.original.modified), 'dd-MMM-yyyy HH:mm')
                        // 
                    }
                </div>
            ),
            sortingFn: 'datetime',
            meta: {
                exportHeaderName: "Actioned Date",
                exportValue: (row) => {
                    return formatDate(new Date(row.modified), 'dd-MMM-yyyy HH:mm');
                }
            }
        },
        // Add more history-specific columns if needed (e.g., rejection reason if captured)
    ]
}