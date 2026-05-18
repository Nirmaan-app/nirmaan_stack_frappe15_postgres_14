/**
 * Side-by-side comparison shown inside the Approve confirmation dialog.
 *
 * Left column = system data (PO doc, Vendor master, computed totals).
 * Right column = AI-extracted data (autofill_extracted_*, autofill_all_entities_json).
 *
 * Top 5 rows are paired (mismatch highlighted in red). Then a divider, and
 * 2 informational rows below (no comparison): system-side totals vs invoice
 * date/no.
 *
 * If the invoice was entered manually (autofill_used = 0), the AI column
 * shows a "No AI extraction" note instead of red mismatches everywhere.
 */
import React, { useMemo } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "date-fns";

/**
 * Robust amount parser. The shared `parseNumber` util uses bare `parseFloat`,
 * which stops at the first non-numeric character — so "3,257.00" becomes 3.
 * Document-AI raw entity values often include commas / currency symbols, so
 * we strip everything except digits, dot, and a leading minus before parsing.
 */
const parseAmount = (value: string | number | undefined | null): number => {
    if (value === undefined || value === null) return 0;
    if (typeof value === "number") return isFinite(value) ? value : 0;
    const cleaned = String(value).replace(/[^\d.\-]/g, "");
    if (!cleaned) return 0;
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
};

interface Props {
    invoice: VendorInvoice;
    /** PO total amount (incl. GST) — already computed by parent. */
    poTotalIncGst: number | undefined;
    /** Sum of payments already paid against this PO. */
    paidAmount: number | undefined;
    /** Amount delivered against this PO. */
    deliveredAmount: number | undefined;
    /** Vendor display name from master. */
    vendorDisplayName: string | undefined;
}

interface ParsedEntities {
    [key: string]: string;
}

const parseEntities = (json: string | undefined): ParsedEntities => {
    if (!json) return {};
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return {};
        const map: ParsedEntities = {};
        for (const entity of parsed) {
            const t = (entity?.type || "").toLowerCase().trim();
            const v = (entity?.value || "").trim();
            if (t && v && !map[t]) map[t] = v;
        }
        return map;
    } catch {
        return {};
    }
};

const normForCompare = (s: string | undefined | null) =>
    (s || "").trim().toLowerCase().replace(/\s+/g, " ");

const ComparisonRow: React.FC<{
    label: string;
    systemValue: React.ReactNode;
    aiValue: React.ReactNode;
    match: boolean | null; // null = don't compare (informational only)
}> = ({ label, systemValue, aiValue, match }) => {
    const aiClass =
        match === false
            ? "text-red-700 font-medium"
            : match === true
                ? "text-green-700"
                : "text-gray-900";
    return (
        <div className="grid grid-cols-[1fr_1fr] gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0">
            <div className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
                <div className="text-sm text-gray-900 break-words">
                    {systemValue || <span className="text-gray-400 italic">—</span>}
                </div>
            </div>
            <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                    {label}
                    {match === true && <CheckCircle2 className="h-3 w-3 text-green-600" />}
                    {match === false && <XCircle className="h-3 w-3 text-red-600" />}
                </div>
                <div className={`text-sm break-words ${aiClass}`}>
                    {aiValue || <span className="text-gray-400 italic">—</span>}
                </div>
            </div>
        </div>
    );
};

export const InvoiceApprovalComparison: React.FC<Props> = ({
    invoice,
    poTotalIncGst,
    paidAmount,
    deliveredAmount,
    vendorDisplayName,
}) => {
    const isPO = invoice.document_type === "Procurement Orders";
    const isSR = invoice.document_type === "Service Requests";
    const parentLabel = isSR ? "SR" : "PO";

    // Fetch PO doc only when this is a PO — gives us project_gst and vendor link.
    const { data: poDoc } = useFrappeGetDoc<ProcurementOrder>(
        "Procurement Orders",
        invoice.document_name,
        isPO && invoice.document_name ? `Approve-Compare-PO-${invoice.document_name}` : null
    );

    // Fetch SR doc when this is a Service Request — same fields (project_gst + vendor).
    const { data: srDoc } = useFrappeGetDoc<ServiceRequests>(
        "Service Requests",
        invoice.document_name,
        isSR && invoice.document_name ? `Approve-Compare-SR-${invoice.document_name}` : null
    );

    // Fetch the vendor master to read vendor_gst.
    const vendorId = invoice.vendor || poDoc?.vendor || srDoc?.vendor;
    const { data: vendorDoc } = useFrappeGetDoc<Vendors>(
        "Vendors",
        vendorId,
        vendorId ? `Approve-Compare-Vendor-${vendorId}` : null
    );

    const entities = useMemo(
        () => parseEntities(invoice.autofill_all_entities_json),
        [invoice.autofill_all_entities_json]
    );

    const aiPurchaseOrder = entities["purchase_order"];
    const aiSupplierName = entities["supplier_name"];
    const aiSupplierGstin = entities["supplier_gstin"];
    const aiReceiverGstin = entities["receiver_gstin"];

    // AI-extracted total. Prefer the dedicated `autofill_extracted_amount` column
    // (already normalized to a numeric string at extraction time). For older
    // invoices that don't have that column populated, fall back to the raw value
    // in `autofill_all_entities_json` — but parse robustly because the raw OCR
    // value can include commas/currency symbols (e.g. "3,257.00" → 3257).
    const aiTotalAmount = (() => {
        const dedicated = invoice.autofill_extracted_amount;
        if (dedicated !== undefined && dedicated !== null && String(dedicated).length > 0) {
            return parseAmount(dedicated);
        }
        return parseAmount(entities["total_amount"]);
    })();

    // System-side values
    const systemPoId = invoice.document_name;
    const systemVendorName = vendorDisplayName || vendorDoc?.vendor_name || invoice.vendor || "";
    const systemVendorGst = (vendorDoc?.vendor_gst || "").toString().trim();
    // Receiver GSTIN from whichever parent doc loaded (PO or SR — same field name).
    const systemReceiverGst = (poDoc?.project_gst || srDoc?.project_gst || "").toString().trim();
    const systemPoTotal = poTotalIncGst ?? 0;

    // Match logic
    const poIdMatch = aiPurchaseOrder ? normForCompare(systemPoId) === normForCompare(aiPurchaseOrder) : null;
    const vendorNameMatch = aiSupplierName ? normForCompare(systemVendorName) === normForCompare(aiSupplierName) : null;
    const vendorGstMatch = aiSupplierGstin && systemVendorGst
        ? systemVendorGst.toUpperCase() === aiSupplierGstin.toUpperCase()
        : null;
    const poGstMatch = aiReceiverGstin && systemReceiverGst
        ? systemReceiverGst.toUpperCase() === aiReceiverGstin.toUpperCase()
        : null;
    // Amount: not a strict match (partial invoices are normal). Just show both;
    // mark mismatch only if the AI total exceeds PO total.
    // Tolerate up to ₹10 of rounding drift — must match the backend hard-block
    // threshold in update_invoice_data._check_po_amount_overage.
    const aiTotalExceeds =
        aiTotalAmount > 0 && systemPoTotal > 0 && aiTotalAmount > systemPoTotal + 10;
    const amountMatch: boolean | null = aiTotalAmount > 0 ? !aiTotalExceeds : null;

    const usedAutofill = !!invoice.autofill_used;

    const formattedInvoiceDate = (() => {
        const d = invoice.invoice_date;
        if (!d) return "";
        try {
            return formatDate(new Date(d), "dd-MMM-yyyy");
        } catch {
            return d;
        }
    })();

    return (
        <div className="space-y-3 pt-2">
            <div className="grid grid-cols-[1fr_1fr] gap-3 px-3 py-1.5 bg-gray-50 rounded-t-md border border-gray-200">
                <div className="text-xs font-semibold text-gray-700">{parentLabel} Details (System)</div>
                <div className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Invoice Details (AI Extracted)
                </div>
            </div>

            <div className="border border-gray-200 rounded-md -mt-3">
                <ComparisonRow
                    label={`${parentLabel} ID`}
                    systemValue={systemPoId}
                    aiValue={
                        usedAutofill ? (
                            aiPurchaseOrder || <span className="text-gray-400 italic">not extracted</span>
                        ) : (
                            <span className="text-gray-400 italic">manual entry</span>
                        )
                    }
                    match={usedAutofill ? poIdMatch : null}
                />
                <ComparisonRow
                    label="Vendor Name"
                    systemValue={systemVendorName}
                    aiValue={
                        usedAutofill ? (
                            aiSupplierName || <span className="text-gray-400 italic">not extracted</span>
                        ) : (
                            <span className="text-gray-400 italic">manual entry</span>
                        )
                    }
                    match={usedAutofill ? vendorNameMatch : null}
                />
                <ComparisonRow
                    label="Vendor GSTIN"
                    systemValue={systemVendorGst || <span className="text-gray-400 italic">not set</span>}
                    aiValue={
                        usedAutofill ? (
                            aiSupplierGstin || <span className="text-gray-400 italic">not extracted</span>
                        ) : (
                            <span className="text-gray-400 italic">manual entry</span>
                        )
                    }
                    match={usedAutofill ? vendorGstMatch : null}
                />
                <ComparisonRow
                    label={`${parentLabel} GSTIN (Receiver)`}
                    systemValue={systemReceiverGst || <span className="text-gray-400 italic">not set</span>}
                    aiValue={
                        usedAutofill ? (
                            aiReceiverGstin || <span className="text-gray-400 italic">not extracted</span>
                        ) : (
                            <span className="text-gray-400 italic">manual entry</span>
                        )
                    }
                    match={usedAutofill ? poGstMatch : null}
                />
                <ComparisonRow
                    label="Amount (Incl. GST)"
                    systemValue={formatToRoundedIndianRupee(systemPoTotal)}
                    aiValue={
                        usedAutofill ? (
                            aiTotalAmount > 0
                                ? formatToRoundedIndianRupee(aiTotalAmount)
                                : <span className="text-gray-400 italic">not extracted</span>
                        ) : (
                            <span className="text-gray-400 italic">manual entry</span>
                        )
                    }
                    match={usedAutofill ? amountMatch : null}
                />
            </div>

            {/* Visual divider between compare-rows and informational-rows */}
            <div className="flex items-center gap-2 px-1">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-[10px] uppercase tracking-wide text-gray-400">For reference</span>
                <div className="flex-1 h-px bg-gray-200" />
            </div>

            <div className="border border-gray-200 rounded-md">
                <div className="grid grid-cols-[1fr_1fr] gap-3 px-3 py-2 border-b border-gray-100">
                    <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Amount Paid</div>
                        <div className="text-sm text-gray-900">
                            {formatToRoundedIndianRupee(paidAmount ?? 0)}
                        </div>
                    </div>
                    <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Invoice Date</div>
                        <div className="text-sm text-gray-900">
                            {formattedInvoiceDate || <span className="text-gray-400 italic">—</span>}
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-[1fr_1fr] gap-3 px-3 py-2">
                    <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">PO Amount Delivered</div>
                        <div className="text-sm text-gray-900">
                            {formatToRoundedIndianRupee(deliveredAmount ?? 0)}
                        </div>
                    </div>
                    <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Invoice No.</div>
                        <div className="text-sm text-gray-900 break-all">
                            {invoice.invoice_no || <span className="text-gray-400 italic">—</span>}
                        </div>
                    </div>
                </div>
            </div>

            {!usedAutofill && (
                <div className="text-[11px] text-gray-500 italic px-1">
                    This invoice was entered manually — no AI extraction available to compare.
                </div>
            )}

            {/* Approve confirmation prompt */}
            <div className="text-sm text-muted-foreground text-center pt-2">
                Confirm approval of invoice{" "}
                <strong className="text-primary">{invoice.invoice_no || invoice.name}</strong>?
            </div>
        </div>
    );
};

export default InvoiceApprovalComparison;
