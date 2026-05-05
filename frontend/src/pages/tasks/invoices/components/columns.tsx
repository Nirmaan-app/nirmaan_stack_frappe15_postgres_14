/**
 * Column definitions for Vendor Invoice tables.
 *
 * Updated to use VendorInvoice type instead of InvoiceApprovalTask.
 */
import React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from 'react-router-dom';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X, Info, Sparkles } from 'lucide-react';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { formatDate } from 'date-fns';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import SITEURL from "@/constants/siteURL";
import { parseNumber } from "@/utils/parseNumber";

/**
 * Maps Document AI entity types (snake_case) to human-readable labels.
 */
const ENTITY_LABELS: Record<string, string> = {
    invoice_id: "Invoice Number",
    invoice_number: "Invoice Number",
    invoice_date: "Invoice Date",
    total_amount: "Total Amount",
    net_amount: "Net Amount",
    total_tax_amount: "Total Tax Amount",
    amount_due: "Amount Due",
    supplier_name: "Supplier Name",
    supplier_gstin: "Supplier GSTIN",
    receiver_gstin: "Receiver GSTIN",
    purchase_order: "Purchase Order",
    due_date: "Due Date",
    currency: "Currency",
};

const ACRONYMS = new Set(["gstin", "po", "wo", "pr", "sr", "id", "no"]);

const humanizeEntityType = (type: string): string => {
    if (ENTITY_LABELS[type]) return ENTITY_LABELS[type];
    return type
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((word) => {
            const lower = word.toLowerCase();
            if (ACRONYMS.has(lower)) return lower.toUpperCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
};

const formatEntityValue = (type: string, value: string): string => {
    if (!value) return value;
    // Format date-like fields as dd-MMM-yyyy (project standard).
    if (/date/i.test(type)) {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
            try {
                return formatDate(d, "dd-MMM-yyyy");
            } catch {
                // fall through and return raw value
            }
        }
    }
    return value;
};

/**
 * Renders a small info icon that, on hover, displays all entities Document AI
 * extracted for an invoice (type, value, confidence). Only rendered when the
 * invoice was actually created via autofill.
 */
const AutofillEntitiesHoverCard: React.FC<{ invoice: VendorInvoice }> = ({ invoice }) => {
    if (!invoice.autofill_used || !invoice.autofill_all_entities_json) return null;

    let entities: Array<{ type: string; value: string; confidence: number }> = [];
    try {
        const parsed = JSON.parse(invoice.autofill_all_entities_json);
        if (Array.isArray(parsed)) entities = parsed;
    } catch {
        return null;
    }
    if (entities.length === 0) return null;

    return (
        <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    className="text-amber-600 hover:bg-amber-100 rounded p-1 inline-flex items-center justify-center"
                    aria-label="View AI extraction"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Info className="h-4 w-4" />
                </button>
            </HoverCardTrigger>
            <HoverCardContent className="w-96 p-0 overflow-hidden" align="end">
                <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-700" />
                    <span className="text-xs font-medium text-amber-900">
                        AI Extraction ({entities.length} fields)
                    </span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="text-left px-3 py-1.5 font-medium text-gray-700">Field</th>
                                <th className="text-left px-3 py-1.5 font-medium text-gray-700">Value</th>
                                <th className="text-right px-3 py-1.5 font-medium text-gray-700">Conf.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entities.map((entity, i) => {
                                const conf = entity.confidence;
                                const confColor =
                                    conf >= 0.85
                                        ? "text-green-700"
                                        : conf >= 0.7
                                            ? "text-amber-700"
                                            : "text-red-700";
                                const label = humanizeEntityType(entity.type);
                                const displayValue = formatEntityValue(entity.type, entity.value);
                                return (
                                    <tr key={i} className="border-t border-gray-100">
                                        <td className="px-3 py-1.5 text-[11px] text-gray-700 align-top">
                                            {label}
                                        </td>
                                        <td className="px-3 py-1.5 text-gray-900 break-words">
                                            {displayValue || <span className="text-gray-400 italic">empty</span>}
                                        </td>
                                        <td className={`px-3 py-1.5 text-right font-mono ${confColor}`}>
                                            {(conf * 100).toFixed(0)}%
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};

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
            header: ({ column }) => <DataTableColumnHeader column={column} title="PO/WO ID" />,
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
                                <p>View {docType === "Procurement Orders" ? "PO" : "WO"}: {docName}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
            meta: {
                exportHeaderName: "PO/WO ID",
                exportValue: (row: VendorInvoice) => row.document_name
            }
        },
        {
            accessorKey: "document_type",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
            cell: ({ row }) => (
                <Badge variant={row.original.document_type === "Procurement Orders" ? "secondary" : "outline"}>
                    {row.original.document_type === "Procurement Orders" ? "PO" : "WO"}
                </Badge>
            ),
            enableColumnFilter: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            meta: {
                exportHeaderName: "Type",
                exportValue: (row: VendorInvoice) => row.document_type === "Procurement Orders" ? "PO" : "WO"
            }
        },
        {
            accessorKey: "vendor",
            id: "vendor",
            header: "Vendor",
            cell: ({ row }) => {
                const vendorName = getVendorName?.(row.original.document_name, row.original.document_type);
                return <div>{vendorName || '-'}</div>;
            },
            enableColumnFilter: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
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
                                <AutofillEntitiesHoverCard invoice={invoice} />
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
