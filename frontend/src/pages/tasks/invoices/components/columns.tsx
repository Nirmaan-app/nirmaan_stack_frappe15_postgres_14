/**
 * Column definitions for Vendor Invoice tables.
 *
 * Updated to use VendorInvoice type instead of InvoiceApprovalTask.
 */
import React, { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from 'react-router-dom';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import {
    InvoiceMappingTable,
    useInvoiceMatchedLines,
    usePoItemTotals,
} from "@/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceLineMappingView";
import { InvoiceDataDialog } from "@/pages/ProcurementOrders/purchase-order/components/InvoiceDataDialog";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X, Info, RefreshCw, Sparkles } from 'lucide-react';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { formatDate } from 'date-fns';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import SITEURL from "@/constants/siteURL";
import { parseNumber } from "@/utils/parseNumber";
import { cn } from "@/lib/utils";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import {
    describeApprovalNarrative,
    summariseSkipReasons,
    isCeilingReason,
} from "@/pages/tasks/invoices/utils/autoApproveReasons";
import { ReasonBreakdown, ReasonTitle } from "@/pages/tasks/invoices/components/ReasonBreakdown";
import { humanizeEntityType, formatEntityValue, confColorClass } from "@/pages/tasks/invoices/utils/autofillEntityDisplay";
/**
 * Maps Document AI entity types (snake_case) to human-readable labels.
 */
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
                                const confColor = confColorClass(conf);
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
 * "Invoice Amt" cell with a hover card. On hover-open (and only then, to avoid
 * a fetch-per-row on render) it lazily loads a PO invoice's line mapping and
 * shows the PO / Invoiced comparison. WO/SR or non-mapped invoices show a basic
 * detail card (no, date, amount, status).
 */
const InvoiceAmtHoverCell: React.FC<{
    invoice: VendorInvoice;
    getVendorName?: (orderId: string, type: string) => string;
}> = ({ invoice, getVendorName }) => {
    const [open, setOpen] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const isPO = invoice.document_type === "Procurement Orders";
    // Only autofilled PO invoices can carry a mapping; gate the fetch on the
    // hover being open so a table of N rows fires nothing until hovered.
    const candidate = open && isPO && !!invoice.autofill_used;
    const { lines, hasMapping, isLoading } = useInvoiceMatchedLines(invoice.name, candidate);
    const { poItemsByRow, poItemsById } = usePoItemTotals(invoice.document_name, candidate);

    const amount = formatToRoundedIndianRupee(parseNumber(invoice.invoice_amount));

    return (
        <>
        <HoverCard openDelay={150} closeDelay={100} onOpenChange={setOpen}>
            <HoverCardTrigger asChild>
                <div
                    className="cursor-pointer text-blue-600 hover:text-blue-800 underline decoration-dotted underline-offset-2"
                    onClick={() => setDialogOpen(true)}
                >
                    {amount}
                </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-[440px] p-0 overflow-hidden" align="end">
                <div className="bg-gray-50 border-b px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-900 truncate">
                            {invoice.invoice_no || "Invoice"}
                        </span>
                        {invoice.status && (
                            <Badge
                                variant={invoice.status === "Approved" ? "green" : invoice.status === "Rejected" ? "destructive" : "red"}
                                className="text-[10px] px-1.5 py-0 shrink-0"
                            >
                                {invoice.status}
                            </Badge>
                        )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                        <span>{invoice.invoice_date ? formatDate(new Date(invoice.invoice_date), "dd-MMM-yyyy") : "—"}</span>
                        <span className="text-gray-300">|</span>
                        <span className="font-semibold text-gray-800">{amount}</span>
                        {isPO && <span className="text-gray-300">|</span>}
                        {isPO && (
                            <Link
                                to={`/purchase-orders/${invoice.document_name.replace(/\//g, "&=")}?tab=Dispatched+PO`}
                                className="text-blue-600 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {invoice.document_name}
                            </Link>
                        )}
                    </div>
                </div>
                {hasMapping ? (
                    <InvoiceMappingTable lines={lines} poItemsByRow={poItemsByRow} poItemsById={poItemsById} />
                ) : (
                    <div className="p-3 text-xs text-gray-500">
                        {isLoading ? "Loading item mapping…" : "No item mapping for this invoice."}
                    </div>
                )}
            </HoverCardContent>
        </HoverCard>
        <InvoiceDataDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            visibleStatuses={["Pending", "Approved", "Rejected"]}
            project={invoice.project}
            poNumber={invoice.document_name}
            documentType={invoice.document_type}
            vendor={getVendorName?.(invoice.document_name, invoice.document_type)}
        />
        </>
    );
};

/**
 * ₹ tolerance before an invoiced total counts as breaching the parent's value.
 * MUST match the backend's `_check_po_amount_overage` threshold in
 * `api/delivery_notes/update_invoice_data.py` — what shows amber here is
 * exactly what the server would reject the next invoice for.
 */
const OVERAGE_TOLERANCE_RUPEES = 10;

/**
 * "Invoiced on PO/WO" cell — the running total of every Pending + Approved
 * invoice on this row's PARENT document, rendered as a fraction of the parent's
 * own value so remaining headroom is readable at a glance.
 *
 * Note the scope: this is a GROUP aggregate shown at row altitude, so it repeats
 * identically across every row of the same parent. The "(all invoices)"
 * sub-header and the denominator are what keep that legible — without them it
 * reads as a duplicate of the row's own "Invoice Amt".
 *
 * Clicking opens the InvoiceDataDialog (the same dialog the All-POs table uses)
 * listing that document's invoices + per-invoice item mapping. The invoice list
 * is already in memory (from useTotalInvoicedByDocument) — the dialog only
 * fetches PO items / line mappings when opened.
 */
const InvoiceTotalCell: React.FC<{
    invoice: VendorInvoice;
    getTotalInvoiced?: (docName: string, docType: string) => number;
    getVendorName?: (orderId: string, type: string) => string;
    /** Parent PO/WO value incl. GST — the fraction's denominator. */
    parentTotal?: number;
}> = ({ invoice, getTotalInvoiced, getVendorName, parentTotal }) => {
    const [open, setOpen] = useState(false);

    if (!getTotalInvoiced) return <span className="text-gray-400 italic">—</span>;
    const total = getTotalInvoiced(invoice.document_name, invoice.document_type);
    if (!total) return <span className="text-gray-400 italic">—</span>;

    // No parent value (0 / unset / still loading) → show the total alone rather
    // than a meaningless "/ ₹0".
    const denominator = parentTotal && parentTotal > 0 ? parentTotal : null;
    const isOverage =
        denominator !== null && total > denominator + OVERAGE_TOLERANCE_RUPEES;

    return (
        <>
            <div
                className={cn(
                    "cursor-pointer",
                    isOverage
                        ? "text-amber-700 hover:text-amber-900"
                        : "text-blue-600 hover:text-blue-800"
                )}
                onClick={() => setOpen(true)}
                title={
                    denominator !== null
                        ? `${formatToRoundedIndianRupee(total)} invoiced of ${formatToRoundedIndianRupee(denominator)}${isOverage ? " — exceeds the order value" : ""}. Click to view invoices.`
                        : "View invoices for this document"
                }
            >
                <span className="underline">{formatToRoundedIndianRupee(total)}</span>
                {denominator !== null && (
                    <span className="text-gray-500 whitespace-nowrap">
                        {" / "}
                        {formatToRoundedIndianRupee(denominator)}
                    </span>
                )}
            </div>
            <InvoiceDataDialog
                open={open}
                onOpenChange={setOpen}
                visibleStatuses={["Pending", "Approved"]}
                project={invoice.project}
                poNumber={invoice.document_name}
                documentType={invoice.document_type}
                vendor={getVendorName?.(invoice.document_name, invoice.document_type)}
            />
        </>
    );
};

/**
 * "Not Auto-Approved Reason" cell — why the system did NOT auto-approve this
 * invoice.
 *
 * `auto_approve_skip_reasons` has been persisted since the 13-gate check
 * shipped, and until now nothing rendered it. The tiering + cascade collapse
 * live in the pure `autoApproveReasons` module; this cell only paints them.
 *
 * The chip carries the top flag plus a +N count — all a scannable column can
 * hold. The hover then gives each flag its own write-up (why it blocks, what to
 * do) through the shared `ReasonBreakdown`, so a reviewer can act on the row
 * without going back up to the reason key above the table.
 */
const AutoApproveReasonCell: React.FC<{
    invoice: VendorInvoice;
    onRecheck?: (invoice: VendorInvoice) => void;
}> = ({ invoice, onRecheck }) => {
    const summary = summariseSkipReasons(invoice);
    const narrative = describeApprovalNarrative(invoice, summary);

    if (narrative === "auto") {
        return (
            <Badge variant="green" className="text-[10px] px-1.5 py-0 whitespace-nowrap">
                Auto-approved
            </Badge>
        );
    }
    if (narrative === "clean") {
        return <span className="text-gray-400 italic">—</span>;
    }

    // Eligibility-only rows (a manual entry / a WO) were never candidates —
    // state that plainly instead of dressing it as a failure.
    if (summary.flags.length === 0) {
        return (
            <span className="text-[11px] text-gray-500">
                {summary.eligibility.map((r) => r.label).join(" · ")}
            </span>
        );
    }

    const top = summary.flags[0];
    const extra = summary.flags.length - 1;
    // The button is offered only to a real candidate — the same test the server
    // applies (`recheck_auto_approve.is_candidate`): Pending, on a PO, and
    // already blocked on a PO-value ceiling. A Work Order invoice never shows
    // it, because those gates do not apply to Work Orders at all.
    const canRecheck =
        invoice.status === "Pending" &&
        invoice.document_type === "Procurement Orders" &&
        summary.flags.some((r) => isCeilingReason(r.token));
    const tone =
        summary.highestTier === "blocker"
            ? "text-red-700 bg-red-50 border-red-200"
            : summary.highestTier === "check"
                ? "text-amber-800 bg-amber-50 border-amber-200"
                : "text-gray-600 bg-gray-50 border-gray-200";

    return (
        <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
                <div className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 cursor-default max-w-[210px]", tone)}>
                    <span className="text-[11px] truncate">{top.label}</span>
                    {extra > 0 && (
                        <span className="text-[10px] font-semibold shrink-0">+{extra}</span>
                    )}
                </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-[380px] p-0 overflow-hidden" align="end">
                <div className="flex items-center gap-2 bg-gray-50 border-b px-3 py-2">
                    <span className="text-xs font-medium text-gray-900">
                        {narrative === "approved-with-flags"
                            ? "Approved despite these flags"
                            : "Not auto-approved because"}
                    </span>
                    {summary.flags.length > 1 && (
                        <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                            {summary.flags.length} reasons
                        </span>
                    )}
                </div>
                {/* Each flag gets its own reading, and the list is capped in
                    HEIGHT rather than in count — a five-flag invoice is exactly
                    the one worth reading in full, so truncating it could hide
                    the blocker. A single reason renders whole (no scrollbar on
                    a card that has nothing more to show); two or more scroll
                    inside a fixed frame, with the count in the header saying how
                    many are down there. 264px lands mid-way through the second
                    block, so the cut edge itself reads as "there is more". */}
                <ul
                    className={cn(
                        "divide-y divide-gray-100 p-2",
                        summary.flags.length > 1 && "max-h-[264px] overflow-y-auto"
                    )}
                >
                    {summary.flags.map((reason) => (
                        <li key={reason.token} className="py-2 first:pt-0 last:pb-0">
                            <ReasonTitle reason={reason} />
                            <div className="mt-1.5">
                                <ReasonBreakdown reason={reason} compact />
                            </div>
                        </li>
                    ))}
                </ul>
                {(summary.eligibility.length > 0 || summary.suppressedCount > 0) && (
                    <div className="border-t px-3 py-2 text-[10px] text-gray-500 space-y-0.5">
                        {summary.eligibility.map((r) => (
                            <div key={r.token}>{r.label}</div>
                        ))}
                        {summary.suppressedCount > 0 && (
                            <div>
                                {summary.suppressedCount} further AI check
                                {summary.suppressedCount === 1 ? "" : "s"} not applicable
                            </div>
                        )}
                    </div>
                )}
                {/* The gates do not re-run on their own, so this footer used to
                    end the story with "not re-checked after edits". It is now the
                    place to do something about it — but only when a re-check
                    could actually change this row's answer. Offering the button
                    on an invoice whose every flag is un-re-checkable (hand-typed,
                    or a Work Order) would teach a reviewer that it does nothing. */}
                <div className="flex items-center justify-between gap-2 border-t bg-gray-50 px-3 py-1.5">
                    <span className="text-[10px] text-gray-500">
                        {canRecheck
                            ? "Recorded at creation. Re-check re-runs the PO-value check."
                            : "Recorded at creation; Re-check does not cover this."}
                    </span>
                    {onRecheck && canRecheck && (
                        <button
                            type="button"
                            onClick={() => onRecheck(invoice)}
                            className="flex shrink-0 items-center gap-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <RefreshCw className="h-2.5 w-2.5" />
                            Re-check
                        </button>
                    )}
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
    getVendorName?: (orderId: string, type: string) => string,
    // Returns sum of `invoice_amount` for all Vendor Invoices with same parent
    // (document_type + document_name) AND status in ['Pending', 'Approved'].
    // Same scope as `_existing_invoiced_sum` used by autofill validation.
    getTotalInvoiced?: (docName: string, docType: string) => number,
    // Resolves a user id to a display name, for the "Invoice Added By" column.
    getUserName?: (id: string | undefined) => string,
    // Re-run the gates on ONE invoice. Passed only by the pending table — the
    // history table's rows are already Approved or Rejected, which a re-check
    // skips, so the action would be dead there.
    onRecheckInvoice?: (invoice: VendorInvoice) => void
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
            // Who entered the invoice. Reads `uploaded_by`, NOT `owner`: on 2,864 of
            // 5,042 live rows `owner` is "Administrator" (a bulk-load artifact) while
            // `uploaded_by` carries the actual person. The PO/WO Invoices tabs already
            // surface this same field as "Invoice Uploaded By".
            accessorKey: "uploaded_by",
            id: "uploaded_by",
            header: ({ column }) => (
                <DataTableColumnHeader
                    column={column}
                    title={<span className="whitespace-normal leading-tight inline-block">Invoice Added By</span>}
                />
            ),
            cell: ({ row }) => {
                const userId = row.original.uploaded_by;
                if (!userId) return <span className="text-gray-400 italic">—</span>;
                return <div className="font-medium">{getUserName?.(userId) || userId}</div>;
            },
            size: 150,
            enableColumnFilter: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            meta: {
                facet: { field: "uploaded_by", title: "Invoice Added By" } satisfies FacetDeclaration,
                exportHeaderName: "Invoice Added By",
                exportValue: (row: VendorInvoice) =>
                    getUserName?.(row.uploaded_by) || row.uploaded_by || ""
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
                facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
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
            header: ({ column }) => (
                <DataTableColumnHeader
                    column={column}
                    title={<span className="whitespace-normal leading-tight inline-block">Invoice Amt<br />(incl. GST)</span>}
                />
            ),
            cell: ({ row }) => (
                <InvoiceAmtHoverCell
                    invoice={row.original}
                    getVendorName={getVendorName}
                />
            ),
            size: 150,
            sortingFn: 'alphanumeric',
            meta: {
                exportHeaderName: "Invoice Amt (incl. GST)",
                exportValue: (row: VendorInvoice) => row.invoice_amount
            }
        },
        {
            // Running total invoiced against this row's PARENT PO/WO — the sum of
            // invoice_amount across every Pending+Approved invoice sharing this
            // (document_type + document_name), shown over the parent's own value.
            //
            // Identical to the server's `_existing_invoiced_sum`, so the fraction
            // is exactly what `_check_po_amount_overage` compares when it accepts
            // or rejects the next invoice on this order.
            id: "total_invoiced_for_parent",
            header: ({ column }) => (
                <DataTableColumnHeader
                    column={column}
                    title={<span className="whitespace-normal leading-tight inline-block">Invoiced on PO/WO<br />(all invoices)</span>}
                />
            ),
            cell: ({ row }) => (
                <InvoiceTotalCell
                    invoice={row.original}
                    getTotalInvoiced={getTotalInvoiced}
                    getVendorName={getVendorName}
                    parentTotal={parseNumber(
                        getTotalAmount?.(row.original.document_name, row.original.document_type)?.totalWithTax
                    )}
                />
            ),
            size: 190,
            enableSorting: false,
            meta: {
                exportHeaderName: "Invoiced on PO/WO (Pending + Approved)",
                exportValue: (row: VendorInvoice) =>
                    getTotalInvoiced
                        ? getTotalInvoiced(row.document_name, row.document_type)
                        : ""
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
        {
            // Why the system didn't auto-approve. Reads `auto_approve_skip_reasons`,
            // which the 13-gate check has been writing since it shipped but nothing
            // rendered. On the history table it also exposes flags a human approved
            // past. Both fields are already in the table's fetch list.
            id: "auto_approve_skip_reasons",
            header: ({ column }) => (
                <DataTableColumnHeader
                    column={column}
                    title={<span className="whitespace-normal leading-tight inline-block">Not Auto-Approved<br />Reason</span>}
                />
            ),
            cell: ({ row }) => (
                <AutoApproveReasonCell
                    invoice={row.original}
                    onRecheck={onRecheckInvoice}
                />
            ),
            size: 220,
            enableSorting: false,
            meta: {
                exportHeaderName: "Not Auto-Approved Reason",
                exportValue: (row: VendorInvoice) => {
                    if (row.auto_approved === 1) return "Auto-approved";
                    const summary = summariseSkipReasons(row);
                    const parts = [
                        ...summary.flags.map((r) => r.label),
                        ...summary.eligibility.map((r) => r.label),
                    ];
                    return parts.join("; ");
                }
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
    getVendorName?: (orderId: string, type: string) => string,
    getTotalInvoiced?: (docName: string, docType: string) => number,
    getUserName?: (id: string | undefined) => string,
    onRecheckInvoice?: (invoice: VendorInvoice) => void
): ColumnDef<VendorInvoice>[] => [
        ...getCommonColumns(attachmentsMap, getTotalAmount, getAmount, getDeliveredAmount, getVendorName, getTotalInvoiced, getUserName, onRecheckInvoice),
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
    getVendorName?: (orderId: string, type: string) => string,
    getTotalInvoiced?: (docName: string, docType: string) => number
): ColumnDef<VendorInvoice>[] => [
        ...getCommonColumns(attachmentsMap, getTotalAmount, getAmount, getDeliveredAmount, getVendorName, getTotalInvoiced, getUserName),
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
            enableColumnFilter: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            meta: {
                facet: { field: "status", title: "Status" } satisfies FacetDeclaration,
                exportHeaderName: "Status",
                exportValue: (row: VendorInvoice) => row.status
            }
        },
        {
            accessorKey: "approved_by",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Actioned By" />,
            cell: ({ row }) => {
                if (row.original.status === "Pending") return <div>N/A</div>;
                // Auto-approved invoices have approved_by = "System". Surface
                // the "(Auto)" suffix inline instead of a separate column so
                // reviewers can see at a glance that the system stamped it.
                if (row.original.approved_by === "System") {
                    return <div>System (Auto)</div>;
                }
                return <div>{getUserName(row.original.approved_by) || 'Administrator'}</div>;
            },
            meta: {
                exportHeaderName: "Actioned By",
                exportValue: (row: VendorInvoice) =>
                    row.approved_by === "System"
                        ? "System (Auto)"
                        : getUserName(row.approved_by) || 'Administrator'
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
