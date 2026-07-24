/**
 * Shared display helpers for AI-extracted autofill entities.
 *
 * Extracted from the invoice table's AutofillEntitiesHoverCard so the upload
 * dialog's new extraction-review UI renders entities identically (labels, date
 * formatting, confidence colouring). Single source of truth for both surfaces.
 */
import { formatDate } from "date-fns";

/** Maps extracted entity types (snake_case) to human-readable labels. */
export const ENTITY_LABELS: Record<string, string> = {
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

export const humanizeEntityType = (type: string): string => {
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

export const formatEntityValue = (type: string, value: string): string => {
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

/** Tailwind text-colour class for a 0..1 confidence score (≥85 green, ≥70 amber, else red). */
export const confColorClass = (conf: number): string =>
    conf >= 0.85 ? "text-green-700" : conf >= 0.7 ? "text-amber-700" : "text-red-700";
