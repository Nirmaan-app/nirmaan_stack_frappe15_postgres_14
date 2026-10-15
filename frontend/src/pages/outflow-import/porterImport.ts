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
export const PORTER_RETRY_METHOD = "nirmaan_stack.api.outflow_import.porter.retry_porter_invoice";

/** The URL parameter that holds the Porter import the dialog is showing, so a reload reopens it. */
export const PORTER_URL_KEY = "porter";

/** How often the dialog asks how validation is going. Polled, no socket — following Cashbook. */
export const PORTER_STATUS_POLL_MS = 2000;

/**
 * A Porter Invoice's validation states, as `Porter Invoice.validation_status` spells them, in the order an
 * invoice moves through them. Pinned to the doctype's options by test.
 */
export const PORTER_INVOICE_STATES = [
    "Queued",
    "Downloading",
    "Reading",
    "Comparing",
    "Passed",
    "Failed",
    "Error",
] as const;
export type PorterInvoiceState = (typeof PORTER_INVOICE_STATES)[number];

/**
 * The import's own state, DERIVED on the server from its invoices (`porter.import_state`), never stored.
 * Pinned to the server's spelling by test.
 */
export const PORTER_IMPORT_STATES = ["Validating", "Validated", "Validation failed"] as const;
export type PorterImportState = (typeof PORTER_IMPORT_STATES)[number];

/** What Gemini read off the invoice PDF; a value it could not read is null. */
export interface PorterInvoiceRead {
    invoice_number: string | null;
    invoice_date: string | null;
    supplier_gstin: string | null;
    receiver_gstin: string | null;
    fare: number | null;
    tax: number | null;
}

export interface PorterInvoiceStatus {
    name: string;
    invoice_number: string;
    city: string;
    billing_entity: string;
    porter_gstin?: string;
    customer_gstin?: string;
    completed_orders: number;
    fare_total: number;
    tax_total: number;
    validation_status: PorterInvoiceState | string;
    validation_message?: string | null;
    can_retry?: boolean;
    has_pdf?: boolean;
    /** Null until Gemini has read the PDF (`porter.what_gemini_read`). */
    read?: PorterInvoiceRead | null;
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
    state: PorterImportState | string;
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

// --- validation (#1444) ---------------------------------------------------------------------------

/** The dialog polls while the server still has invoices in hand, and stops once the import is decided. */
export const porterValidationRunning = (status: Pick<PorterStatus, "state"> | null | undefined): boolean =>
    status?.state === "Validating";

export type ProgressMark = "todo" | "current" | "done" | "passed" | "failed";

const PROGRESS_STEPS = ["Downloading", "Reading", "Comparing"] as const;
const OUTCOME_MARK: Record<string, ProgressMark> = { Passed: "passed", Failed: "failed", Error: "failed" };

/**
 * One invoice's card: Downloading → Reading → Comparing → its outcome (Passed / Failed / Error).
 *
 * ⚠️ AN ERROR'S STEP IS READ OFF WHAT THE INVOICE HOLDS. The server records where an invoice stands, not
 * where it stood when it broke: no stored PDF means the download broke; a PDF and nothing read means
 * Gemini broke; something read means the comparison could not decide (a figure was not read).
 */
export const invoiceProgress = (
    invoice: Pick<PorterInvoiceStatus, "validation_status" | "has_pdf" | "read">,
): { label: string; mark: ProgressMark }[] => {
    const state = invoice.validation_status;
    const outcome = OUTCOME_MARK[state];
    const brokeAt = state === "Error" ? (!invoice.has_pdf ? 0 : !invoice.read ? 1 : 2) : -1;
    const at = PROGRESS_STEPS.indexOf(state as (typeof PROGRESS_STEPS)[number]);
    const steps = PROGRESS_STEPS.map((label, index) => {
        let mark: ProgressMark;
        if (brokeAt >= 0) mark = index < brokeAt ? "done" : index === brokeAt ? "failed" : "todo";
        else if (outcome) mark = "done";
        else mark = index < at ? "done" : index === at ? "current" : "todo";
        return { label, mark };
    });
    return [...steps, outcome ? { label: state, mark: outcome } : { label: "Result", mark: "todo" }];
};

/** An invoice number or GSTIN as the server compares it: no spaces, upper case (`porter._ident`). */
const ident = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toUpperCase();

/** The server's ±₹1 on fare and tax (`porter.COMPARE_TOLERANCE`). */
const COMPARE_TOLERANCE = 1;

export interface InvoiceFigureRow {
    label: string;
    statement: string | number;
    read: string | number | null;
    money: boolean;
    /** Gemini read a value and it is not the statement's. Never true before it has read. */
    differs: boolean;
}

/**
 * The statement's figures beside what Gemini read, one row per figure the check compares (story 16).
 *
 * ⚠️ `differs` ONLY HIGHLIGHTS. The verdict is the server's (`validation_status` and its message), and
 * this mirrors its rule only so the row that broke it stands out.
 */
export const invoiceFigureRows = (
    invoice: Pick<
        PorterInvoiceStatus,
        "invoice_number" | "porter_gstin" | "customer_gstin" | "fare_total" | "tax_total" | "read"
    >,
): InvoiceFigureRow[] => {
    const read = invoice.read;
    const text = (label: string, statement: string | undefined, value: string | null | undefined): InvoiceFigureRow => ({
        label,
        statement: statement ?? "",
        read: value || null,
        money: false,
        differs: Boolean(value) && ident(value) !== ident(statement),
    });
    const money = (label: string, statement: number, value: number | null | undefined): InvoiceFigureRow => ({
        label,
        statement,
        read: value ?? null,
        money: true,
        differs: value != null && Math.abs(value - statement) > COMPARE_TOLERANCE + 1e-9,
    });
    return [
        text("Invoice number", invoice.invoice_number, read?.invoice_number),
        text("Porter GSTIN", invoice.porter_gstin, read?.supplier_gstin),
        text("Customer GSTIN", invoice.customer_gstin, read?.receiver_gstin),
        money("Fare", invoice.fare_total, read?.fare),
        money("Tax", invoice.tax_total, read?.tax),
    ];
};

/**
 * Retry is offered on an *Error* only — a download or Gemini failure decided nothing. A *Failed* invoice
 * disagrees with the statement and is final: there is no override, for anyone (ADR-0032).
 */
export const canRetryInvoice = (invoice: Pick<PorterInvoiceStatus, "validation_status">): boolean =>
    invoice.validation_status === "Error";

/** What the import's state means for the accountant, in one sentence. */
export const porterStateNote = (state: string): string => {
    if (state === "Validated")
        return "Every invoice agrees with Porter's own PDF. Nothing has been created yet.";
    if (state === "Validation failed")
        return "Nothing will be created from this import: every invoice has to agree with Porter's PDF. Retry an invoice that hit an Error; a Failed one is final.";
    return "Checking each invoice against Porter's own PDF. You can close this — it carries on, and Import History reopens it.";
};

/** The tone of the import's state chip. */
export const porterStateTone = (state: string): "passed" | "failed" | "pending" =>
    state === "Validated" ? "passed" : state === "Validation failed" ? "failed" : "pending";
