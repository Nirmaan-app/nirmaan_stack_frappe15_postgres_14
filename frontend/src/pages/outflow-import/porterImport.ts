// src/pages/outflow-import/porterImport.ts
//
// The Porter Statement import's view logic, as pure data (#1443, ADR-0032). No React, no fetch, no DOM.
// `PorterImportSummary` renders it; `porterImport.test.ts` pins it. Later slices of spec #1442
// (validation progress, review, create) extend THIS module.

import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

import { NEEDS_YOU_STATE, type PorterProgress } from "./porterProgress";
import type { PorterFailedLine } from "./porterResult";
import { plural } from "./porterWords";

/** The source string. The parser adapter key and the batch Select option, pinned by test. */
export const PORTER_SOURCE = "Porter Statement";

export const PORTER_UPLOAD_URL =
    "/api/method/nirmaan_stack.api.outflow_import.porter.upload_porter_statement";
export const PORTER_STATUS_METHOD = "nirmaan_stack.api.outflow_import.porter.get_porter_status";
export const PORTER_RETRY_METHOD = "nirmaan_stack.api.outflow_import.porter.retry_porter_invoice";

/** The URL parameter that holds the Porter import the dialog is showing, so a reload reopens it. */
export const PORTER_URL_KEY = "porter";

/**
 * Whether choosing `batch` from a list of statements (the Import selector, Import History) opens the Porter
 * dialog rather than pinning the table to it. A Porter import's lines are not bank lines: pinned, the
 * table shows nothing (#1444).
 */
export const opensPorterDialog = (
    batch: string | undefined,
    options: readonly { name: string; source?: string | null }[],
): boolean => Boolean(batch) && isPorterImport(options.find((option) => option.name === batch)?.source);

/** Whether a statement of this `source` is a Porter import (the one-statement form of `opensPorterDialog`). */
export const isPorterImport = (source: string | null | undefined): boolean => (source ?? "").trim() === PORTER_SOURCE;

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
export const PORTER_IMPORT_STATES = ["Validating", "Validated", "Validation failed", "Creating", "Created"] as const;
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
    /** Figures the PDF read differently that decide nothing: GSTINs, tax, invoice number (#1559). */
    warnings?: PorterInvoiceWarning[];
}

/** One figure the PDF read differently from the statement (`porter_verdict.InvoiceWarning`); `read` null when unread. */
export interface PorterInvoiceWarning {
    figure: string;
    statement: string;
    read: string | null;
}

/** The dates (ISO, both included) an invoice of this statement may carry (`porter_verdict.invoice_date_window`). */
export interface InvoiceDateWindow {
    from: string;
    to: string;
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
    /** Orders on invoices already created, left out of this upload (#1447). */
    repeats_not_saved?: number;
    /** Create has written nothing, so Discard is possible (#1447). Who may discard is the screen's question. */
    discardable?: boolean;
    state: PorterImportState | string;
    invoices: PorterInvoiceStatus[];
    /** Create's progress (#1445), counted from the lines: what a run would still write, what it has. */
    to_create: number;
    created: number;
    failed: number;
    /** The Create job is queued or running on the server. */
    create_running: boolean;
    /** Per phase: what is done, what is waiting and what needs a person (#1556). The progress bar reads it. */
    progress?: PorterProgress;
    /** Each line Create could not create: its CRN, the note it stored and its fix (#1561). */
    failed_lines?: PorterFailedLine[];
    /** The Porter Orders that have an Expense, by expense doctype (`porter_records.created_expenses`, #1561). */
    created_expenses?: Record<string, string[]>;
    /** Null when the statement has no period (no order dates). */
    invoice_date_window?: InvoiceDateWindow | null;
}

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

/**
 * The badge tone of an invoice's state: passed, doesn't match (red), couldn't be read (amber: a retry is
 * the person's turn), or still in hand.
 */
export const invoiceStateTone = (state: string): "passed" | "failed" | "retry" | "pending" =>
    state === "Passed" ? "passed" : state === "Failed" ? "failed" : state === "Error" ? "retry" : "pending";

/** An invoice's state as a person reads it: the problem states by meaning (story 20). */
export const invoiceStateLabel = (state: string): string =>
    state === "Error" ? "Couldn't read the PDF" : state === "Failed" ? "Doesn't match" : state;

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
    return [...steps, outcome ? { label: invoiceStateLabel(state), mark: outcome } : { label: "Result", mark: "todo" }];
};

/** The server's ±₹1 on the fare (`amounts.PORTER_INVOICE_TOLERANCE`). */
const COMPARE_TOLERANCE = 1;

export interface InvoiceFigureRow {
    label: string;
    statement: string;
    /** As read off the PDF; null before Gemini has read it, or when it could not. */
    read: string | null;
    /** Gemini read a value and it fails the check. Never true before it has read. */
    differs: boolean;
}

const fareDiffers = (statement: number, read: number | null | undefined) =>
    read != null && Math.abs(read - statement) > COMPARE_TOLERANCE + 1e-9;

/** ISO dates compare as strings. */
const dateOutside = (read: string | null | undefined, window: InvoiceDateWindow | null | undefined) =>
    Boolean(read && window && (read < window.from || read > window.to));

const windowText = (window: InvoiceDateWindow | null | undefined) =>
    window ? `${formatDate(window.from)} to ${formatDate(window.to)}` : "—";

/**
 * The two figures that decide an invoice (#1559) — the Porter fare, and the invoice date against the dates
 * this statement's invoices may carry — beside what Gemini read.
 *
 * ⚠️ `differs` ONLY HIGHLIGHTS. The verdict is the server's (`validation_status` and its message): the fare
 * mirrors its ±₹1 only so the row that broke it stands out, and the date window is the server's own.
 */
export const invoiceFigureRows = (
    invoice: Pick<PorterInvoiceStatus, "fare_total" | "read">,
    window: InvoiceDateWindow | null | undefined,
): InvoiceFigureRow[] => {
    const read = invoice.read;
    return [
        {
            label: "Fare",
            statement: formatToIndianRupee(invoice.fare_total),
            read: read?.fare != null ? formatToIndianRupee(read.fare) : null,
            differs: fareDiffers(invoice.fare_total, read?.fare),
        },
        {
            label: "Invoice date",
            statement: windowText(window),
            read: read?.invoice_date ? formatDate(read.invoice_date) : null,
            differs: dateOutside(read?.invoice_date, window),
        },
    ];
};

/** How a warned figure is named mid-sentence. */
const WARNING_NOUN: Record<string, string> = {
    "Invoice number": "invoice number",
    "Porter GSTIN": "Porter GSTIN",
    "Customer GSTIN": "customer GSTIN",
    Tax: "tax",
};

/**
 * A Passed invoice's one quiet line (story 17): the GST is the statement's whatever the PDF says, and what
 * the PDF read differently. Null when nothing differs.
 */
export const warningLine = (warnings: readonly PorterInvoiceWarning[] | null | undefined): string | null => {
    if (!warnings?.length) return null;
    const parts = warnings.map(({ figure, statement, read }) => {
        const noun = WARNING_NOUN[figure] ?? figure;
        return read === null ? `the PDF's ${noun} couldn't be read` : `the PDF read the ${noun} as ${read}, not ${statement}`;
    });
    const sentence = parts.join("; ");
    return `GST taken from the statement. ${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
};

/** What to do about an invoice that doesn't match (story 21). */
export const NOT_MATCHING_NEXT_STEP =
    "Read it again. If it still differs, ask Porter for a corrected file, then discard this import and upload the new one.";

/**
 * The red banner over the invoices when any doesn't match: a title, one sentence per invoice naming the
 * figure (statement vs PDF), and the next step. Null when none is Failed.
 */
export const notMatchingBanner = (
    invoices: readonly PorterInvoiceStatus[],
    window: InvoiceDateWindow | null | undefined,
): { title: string; lines: string[]; next: string } | null => {
    const failed = invoices.filter((invoice) => invoice.validation_status === "Failed");
    if (failed.length === 0) return null;
    const lines = failed.flatMap((invoice) => {
        const read = invoice.read;
        const said: string[] = [];
        if (fareDiffers(invoice.fare_total, read?.fare)) {
            said.push(
                `Invoice ${invoice.invoice_number}: the fare is ${formatToIndianRupee(invoice.fare_total)} in the statement but ${formatToIndianRupee(read?.fare ?? 0)} on the PDF.`,
            );
        }
        if (read?.invoice_date && dateOutside(read.invoice_date, window)) {
            said.push(
                `Invoice ${invoice.invoice_number}: the PDF is dated ${formatDate(read.invoice_date)}, but this statement's invoices must be dated ${windowText(window)}.`,
            );
        }
        // Nothing to name from here (an older reading): the server's own message says it.
        return said.length ? said : [invoice.validation_message ?? `Invoice ${invoice.invoice_number} doesn't match.`];
    });
    const title =
        failed.length === 1 ? "1 invoice doesn't match Porter's PDF." : `${failed.length} invoices don't match Porter's PDF.`;
    return { title, lines, next: NOT_MATCHING_NEXT_STEP };
};

/**
 * Which invoice cards are in view (story 27): every one with something to say — a problem, a check still
 * running, a warning — and the ones that simply passed folded under one line. `foldAll` folds every passed
 * invoice, warned or not (once the review leads). `foldLabel` is null when nothing is folded.
 */
export const foldPassedInvoices = <T extends Pick<PorterInvoiceStatus, "validation_status" | "warnings">>(
    invoices: readonly T[],
    foldAll: boolean,
): { shown: T[]; folded: T[]; foldLabel: string | null } => {
    const folds = (invoice: T) => invoice.validation_status === "Passed" && (foldAll || !invoice.warnings?.length);
    const shown = invoices.filter((invoice) => !folds(invoice));
    const folded = invoices.filter(folds);
    const noun = folded.length === 1 ? "invoice" : "invoices";
    const foldLabel =
        folded.length === 0 ? null : `${folded.length} ${shown.length ? "more " : ""}${noun} passed`;
    return { shown, folded, foldLabel };
};

/**
 * The retry button's label, or null when the invoice has nothing to retry (#1562). Both download, read and
 * judge the invoice again: a *Failed* one in case Gemini misread it ("Read the PDF again"), an *Error* one
 * because nothing was decided ("Try again"). There is still no override (ADR-0032).
 */
export const retryLabel = (invoice: Pick<PorterInvoiceStatus, "validation_status">): string | null =>
    invoice.validation_status === "Failed"
        ? "Read the PDF again"
        : invoice.validation_status === "Error"
          ? "Try again"
          : null;

/** What the import's state means for the accountant, in one sentence. */
export const porterStateNote = (state: string): string => {
    if (state === "Created")
        return "Done: one expense per completed order, at Paid, each with its Porter invoice attached.";
    // A partly created import with no Create job running (`porterProgress.shownPorterState`, #1556).
    if (state === NEEDS_YOU_STATE)
        return "Not every order is created yet, and nothing is running: press Create again for the rest.";
    if (state === "Creating")
        return "Creating the expenses, one order at a time. You can close this — it carries on, and Import History reopens it.";
    if (state === "Validated")
        return "Every invoice agrees with Porter's own PDF. Nothing has been created yet.";
    if (state === "Validation failed")
        return "Nothing will be created from this import: every invoice has to agree with Porter's PDF on the fare and the invoice date. Read a mismatched PDF again, or try again on one that couldn't be read.";
    return "Checking each invoice against Porter's own PDF. You can close this — it carries on, and Import History reopens it.";
};

/** The tone of the import's state chip. */
export const porterStateTone = (state: string): "passed" | "failed" | "attention" | "pending" => {
    if (state === "Validated" || state === "Created") return "passed";
    if (state === "Validation failed") return "failed";
    // A partly created import with no Create running: a person's turn.
    if (state === NEEDS_YOU_STATE) return "attention";
    return "pending";
};

// --- create (#1445) -------------------------------------------------------------------------------

export const PORTER_CREATE_METHOD = "nirmaan_stack.api.outflow_import.porter_create.create_porter_expenses";

export type PorterCreateProgress = Pick<
    PorterStatus,
    "state" | "completed" | "to_create" | "created" | "failed" | "create_running"
>;

/** Create has started on this import (Creating or Created): the stepper is on its Create step. */
export const porterCreateStarted = (status: { state: string } | null | undefined): boolean =>
    status?.state === "Creating" || status?.state === "Created";

/** The dialog polls while the invoices are being checked, or while the Create job is queued or running. */
export const porterPolling = (status: Pick<PorterStatus, "state" | "create_running"> | null | undefined): boolean =>
    status?.state === "Validating" || Boolean(status?.create_running);

/**
 * Create is offered on a validated import with orders still to create — including after a run that left
 * a line it could not create, or a line reopened by Unreconcile (the import then reads Creating) — and
 * not while the job is queued or running. The server refuses anything else again.
 */
export const canCreatePorter = (status: PorterCreateProgress): boolean =>
    (status.state === "Validated" || status.state === "Creating") && !status.create_running && status.to_create > 0;

export const createButtonLabel = (status: PorterCreateProgress): string =>
    status.state === "Creating"
        ? `Create the remaining ${status.to_create}`
        : `Create ${plural(status.to_create, "expense", "expenses")}`;

/**
 * Where Create stands, from the lines; null before it has started. Null too once every order is created, or
 * when an order failed: the result (`porterResult`, #1561) says so, naming each failed order.
 */
export const createProgress = (status: PorterCreateProgress): string | null => {
    const of = `${status.created} of ${status.completed} created.`;
    if (status.create_running) return `Creating… ${of}`;
    if (status.state !== "Creating" || status.failed > 0) return null;
    const waiting = status.to_create;
    return `${of} ${waiting} ${waiting === 1 ? "is" : "are"} waiting: press Create again to create ${waiting === 1 ? "it" : "them"}.`;
};
