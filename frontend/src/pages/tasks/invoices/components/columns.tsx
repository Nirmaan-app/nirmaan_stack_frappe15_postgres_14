/**
 * Column definitions for Vendor Invoice tables.
 *
 * Updated to use VendorInvoice type instead of InvoiceApprovalTask.
 */
import { ColumnDef } from "@tanstack/react-table";
import { Link } from 'react-router-dom';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X } from 'lucide-react';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { formatDate } from 'date-fns';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import SITEURL from "@/constants/siteURL";
import { parseNumber } from "@/utils/parseNumber";

/**
 * Helper function for common columns shared between pending and history tables.
 */
const getCommonColumns = (
    attachmentsMap?: Record<string, string>,
    getTotalAmount?: (orderId: string, type: string) => { total: number, totalWithTax: number, totalGst: number },
    getAmount?: (orderId: string, statuses: string[]) => number,
    getDeliveredAmount?: (orderId: string, type: string) => number,
    getVendorName?: (orderId: string, type: string) => string
): ColumnDef<VendorInvoice>[] => [
    {
        accessorKey: "document_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO/SR ID" />,
        cell: ({ row }) => {
            const docType = row.original.document_type;
            const docName = row.original.document_name;
            const isPO = docType === "Procurement Orders";
            const linkDocName = isPO ? docName.replace(/\//g, "&=") : docName;
            const linkTo = docType === "Procurement Orders"
                ? `/purchase-orders/${linkDocName}?tab=Dispatched+PO`
                : `/service-requests/${linkDocName}?tab=approved-sr`;
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
            exportHeaderName: "PO/SR ID",
            exportValue: (row: VendorInvoice) => row.document_name
        }
    },
    {
        accessorKey: "document_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
            <Badge variant={row.original.document_type === "Procurement Orders" ? "secondary" : "outline"}>
                {row.original.document_type === "Procurement Orders" ? "PO" : "SR"}
            </Badge>
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
        meta: {
            exportHeaderName: "Type",
            exportValue: (row: VendorInvoice) => row.document_type === "Procurement Orders" ? "PO" : "SR"
        }
    },
    {
        id: "vendor_name",
        header: "Vendor",
        cell: ({ row }) => {
            const vendorName = getVendorName?.(row.original.document_name, row.original.document_type);
            return <div>{vendorName || '-'}</div>;
        },
        meta: {
            exportHeaderName: "Vendor Name",
            exportValue: (row: VendorInvoice) => {
                if (!row) return "";
                return getVendorName?.(row.document_name, row.document_type) || "";
            }
        }
    },
    {
        id: "po_amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO Amt(incl. GST)" />,
        cell: ({ row }) => {
            const totals = getTotalAmount?.(row.original.document_name, row.original.document_type);
            return <div>{formatToRoundedIndianRupee(parseNumber(totals?.totalWithTax))}</div>;
        },
        size: 150,
        sortingFn: 'alphanumeric',
        meta: {
            exportHeaderName: "Total PO Amt (incl. GST)",
            exportValue: (row: VendorInvoice) => {
                if (!row) return "";
                const totals = getTotalAmount?.(row.document_name, row.document_type);
                return totals?.totalWithTax;
            }
        }
    },
    {
        id: "po_amt_delivered",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO Amt (Delivered)" />,
        cell: ({ row }) => {
            if (row.original.document_type !== "Procurement Orders") {
                return <div>N/A</div>;
            }
            const deliveredAmount = getDeliveredAmount?.(row.original.document_name, row.original.document_type);
            return <div>{formatToRoundedIndianRupee(deliveredAmount)}</div>;
        },
        size: 180,
        sortingFn: 'alphanumeric',
        meta: {
            exportHeaderName: "PO Amt (Delivered)",
            exportValue: (row: VendorInvoice) => {
                if (row.document_type !== "Procurement Orders") return "N/A";
                return getDeliveredAmount?.(row.document_name, row.document_type);
            }
        }
    },
    {
        id: "amount_paid",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amt Paid (incl. GST)" />,
        cell: ({ row }) => {
            return <div>{formatToRoundedIndianRupee(parseNumber(getAmount?.(row.original.document_name, ["Paid"])))}</div>;
        },
        size: 150,
        sortingFn: 'alphanumeric',
        meta: {
            exportHeaderName: "Amt Paid (incl. GST)",
            exportValue: (row: VendorInvoice) => getAmount?.(row.document_name, ["Paid"])
        }
    },
    {
        accessorKey: "invoice_no",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No." />,
        cell: ({ row }) => {
            const invoice_no = row.original.invoice_no;
            const attachmentId = row.original.invoice_attachment;
            return attachmentId ? (
                <div className="font-medium text-blue-500">
                    <HoverCard>
                        <HoverCardTrigger onClick={() => window.open(`${SITEURL}${attachmentsMap?.[attachmentId]}`, '_blank')}>
                            {invoice_no}
                        </HoverCardTrigger>
                        <HoverCardContent className="w-auto rounded-md shadow-lg">
                            <img
                                src={`${SITEURL}${attachmentsMap?.[attachmentId]}`}
                                alt="Invoice"
                                className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                            />
                        </HoverCardContent>
                    </HoverCard>
                </div>
            ) : (
                <div className="font-medium">{invoice_no}</div>
            );
        },
        meta: {
            exportHeaderName: "Invoice No.",
            exportValue: (row: VendorInvoice) => row.invoice_no
        }
    },
    {
        accessorKey: "invoice_amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Amt (incl. GST)" />,
        cell: ({ row }) => (
            <div>{formatToRoundedIndianRupee(parseNumber(row.original.invoice_amount))}</div>
        ),
        sortingFn: 'alphanumeric',
        meta: {
            exportHeaderName: "Invoice Amt (incl. GST)",
            exportValue: (row: VendorInvoice) => row.invoice_amount
        }
    },
    {
        accessorKey: "invoice_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
        cell: ({ row }) => {
            const dateStr = row.original.invoice_date;
            try {
                return dateStr ? formatDate(new Date(dateStr), 'dd-MMM-yyyy') : 'N/A';
            } catch {
                return 'Invalid Date';
            }
        },
        sortingFn: 'datetime',
        meta: {
            exportHeaderName: "Invoice Date",
            exportValue: (row: VendorInvoice) => row.invoice_date
        }
    },
];

/**
 * Columns for pending invoice approval table.
 */
export const getPendingTaskColumns = (
    openConfirmationDialog: (invoice: VendorInvoice, action: "Approved" | "Rejected") => void,
    loadingInvoiceId: string | null,
    isProcessing: boolean,
    attachmentsMap?: Record<string, string>,
    getTotalAmount?: (orderId: string, type: string) => { total: number, totalWithTax: number, totalGst: number },
    getAmount?: (orderId: string, statuses: string[]) => number,
    getDeliveredAmount?: (orderId: string, type: string) => number,
    getVendorName?: (orderId: string, type: string) => string
): ColumnDef<VendorInvoice>[] => [
    ...getCommonColumns(attachmentsMap, getTotalAmount, getAmount, getDeliveredAmount, getVendorName),
    {
        id: "actions",
        header: () => <div className="">Actions</div>,
        cell: ({ row }) => {
            const invoice = row.original;
            const isThisInvoiceLoading = loadingInvoiceId === invoice.name;

            return (
                <div className="flex items-center space-x-1">
                    {isThisInvoiceLoading ? (
                        <span className="px-2 text-xs text-muted-foreground">Processing...</span>
                    ) : (
                        <>
                            <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-green-600 hover:bg-green-100 h-7 w-7"
                                            onClick={() => openConfirmationDialog(invoice, "Approved")}
                                            disabled={isProcessing}
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
                                            variant="ghost"
                                            size="icon"
                                            className="text-red-600 hover:bg-red-100 h-7 w-7"
                                            onClick={() => openConfirmationDialog(invoice, "Rejected")}
                                            disabled={isProcessing}
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

/**
 * Columns for invoice history table.
 */
export const getTaskHistoryColumns = (
    getUserName: (id: string | undefined) => string,
    attachmentsMap?: Record<string, string>,
    getTotalAmount?: (orderId: string, type: string) => { total: number, totalWithTax: number, totalGst: number },
    getDeliveredAmount?: (orderId: string, type: string) => number,
    getAmount?: (orderId: string, statuses: string[]) => number,
    getVendorName?: (orderId: string, type: string) => string
): ColumnDef<VendorInvoice>[] => [
    ...getCommonColumns(attachmentsMap, getTotalAmount, getAmount, getDeliveredAmount, getVendorName),
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
            const status = row.original.status;
            let variant: "green" | "destructive" | "secondary" | "outline" | "warning" = "secondary";
            if (status === 'Approved') variant = 'green';
            else if (status === 'Rejected') variant = 'destructive';
            else if (status === 'Pending') variant = 'outline';
            return <Badge variant={variant}>{status}</Badge>;
        },
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
        meta: {
            exportHeaderName: "Status",
            exportValue: (row: VendorInvoice) => row.status
        }
    },
    {
        accessorKey: "approved_by",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned By" />,
        cell: ({ row }) => {
            if (row.original.status === "Pending") return <div>N/A</div>;
            return <div>{getUserName(row.original.approved_by) || 'Administrator'}</div>;
        },
        meta: {
            exportHeaderName: "Actioned By",
            exportValue: (row: VendorInvoice) => getUserName(row.approved_by) || 'Administrator'
        }
    },
    {
        accessorKey: "approved_on",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned Date" />,
        cell: ({ row }) => {
            if (row.original.status === "Pending") return <div>N/A</div>;
            const dateStr = row.original.approved_on;
            try {
                return dateStr ? formatDate(new Date(dateStr), 'dd-MMM-yyyy HH:mm') : 'N/A';
            } catch {
                return 'N/A';
            }
        },
        sortingFn: 'datetime',
        meta: {
            exportHeaderName: "Actioned Date",
            exportValue: (row: VendorInvoice) => {
                try {
                    return row.approved_on ? formatDate(new Date(row.approved_on), 'dd-MMM-yyyy HH:mm') : '';
                } catch {
                    return '';
                }
            }
        }
    },
    {
        accessorKey: "rejection_reason",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rejection Reason" />,
        cell: ({ row }) => {
            if (row.original.status !== "Rejected") return <div>-</div>;
            return (
                <TooltipProvider delayDuration={100}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="max-w-[150px] truncate text-red-600">
                                {row.original.rejection_reason || '-'}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[300px]">
                            <p>{row.original.rejection_reason}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        },
        meta: {
            exportHeaderName: "Rejection Reason",
            exportValue: (row: VendorInvoice) => row.rejection_reason || ''
        }
    },
];
