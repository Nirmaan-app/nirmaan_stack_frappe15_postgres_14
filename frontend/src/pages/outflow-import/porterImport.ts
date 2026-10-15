// src/pages/outflow-import/porterImport.ts
//
// The Porter Statement import's view logic, as pure data (#1443, ADR-0032). No React, no fetch, no DOM.
// `PorterImportSummary` renders it; `porterImport.test.ts` pins it. Later slices of spec #1442
// (validation progress, review, create) extend THIS module.

/** The source string. The parser adapter key and the batch Select option, pinned by test. */
export const PORTER_SOURCE = "Porter Statement";

export const PORTER_UPLOAD_URL =
    "/api/method/nirmaan_stack.api.outflow_import.porter.upload_porter_statement";
export const PORTER_STATUS_METHOD = "nirmaan_stack.api.outflow_import.porter.get_porter_status";

/** A Porter Invoice's validation state, as `Porter Invoice.validation_status` spells it. */
export type PorterInvoiceState =
    | "Queued"
    | "Downloading"
    | "Reading"
    | "Comparing"
    | "Passed"
    | "Failed"
    | "Error";

export interface PorterInvoiceStatus {
    name: string;
    invoice_number: string;
    city: string;
    billing_entity: string;
    completed_orders: number;
    fare_total: number;
    tax_total: number;
    validation_status: PorterInvoiceState | string;
    validation_message?: string | null;
}

/** What `upload_porter_statement` and `get_porter_status` return: one shape for both. */
export interface PorterStatus {
    batch: string;
    source: string;
    original_filename: string;
    period_from: string | null;
    period_to: string | null;
    orders: number;
    completed: number;
    cancelled: number;
    fare_total: number;
    invoices: PorterInvoiceStatus[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The one line that tells the accountant at once whether this is the month they meant (story 3):
 * how many orders, invoices and cancelled orders the file holds.
 */
export const porterCountsLine = (status: Pick<PorterStatus, "orders" | "cancelled" | "invoices">): string => {
    const parts = [
        plural(status.orders, "order", "orders"),
        plural(status.invoices.length, "invoice", "invoices"),
    ];
    if (status.cancelled > 0) parts.push(`${plural(status.cancelled, "cancelled order", "cancelled orders")} skipped`);
    return parts.join(" · ");
};

/** The badge tone of an invoice's state: settled good, settled bad, or still in hand. */
export const invoiceStateTone = (state: string): "passed" | "failed" | "pending" =>
    state === "Passed" ? "passed" : state === "Failed" || state === "Error" ? "failed" : "pending";

/**
 * What the import has done and what it has not, in words.
 *
 * ⚠️ IT SAYS NOTHING WAS CREATED, BECAUSE NOTHING WAS. Upload writes the lines and the Porter Invoices
 * only; every Expense waits until every invoice agrees with Porter's own PDF (ADR-0032).
 */
export const PORTER_UPLOADED_NOTE =
    "Uploaded. Nothing has been created yet: every invoice is checked against Porter's own PDF first, and no expense is created unless all of them agree.";
