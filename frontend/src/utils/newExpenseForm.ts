/**
 * Which fields the New Expense form asks, driven by the expense type (spec #1494, ticket #1501).
 * Pure, so the rule tests without React; `NewExpenseRequestDialog` renders what it returns.
 *
 * The order on screen is Type, Amount, Project, Vendor, Who gets paid, then the details: the type's
 * own questions when it has a form, otherwise Description (required) and Comment (optional).
 * Who gets paid has its own rule (`utils/payees/expensePayee`).
 */

import type { RequestCatalogType } from "@/types/NirmaanStack/ExpenseRequest";

/** The Project field: absent on a non-project type, required on a project-only type. */
export type ProjectField = "hidden" | "optional" | "required";

/** What the form asks after Who gets paid: the type's own questions, or a Description. */
export type DetailsField = "none" | "loading" | "form" | "description";

export interface NewExpenseFieldsInput {
    /** The picked type's catalog entry; undefined until a type is picked. */
    type: Pick<RequestCatalogType, "project_allowed" | "project_required" | "has_format"> | undefined;
    /** A project is chosen on the form. */
    projectChosen: boolean;
    /** The type's form is still being fetched. */
    formatLoading: boolean;
    /** The type's form was fetched and parsed. */
    formatReady: boolean;
}

export interface NewExpenseFields {
    project: ProjectField;
    /** The optional Vendor picker. */
    vendor: boolean;
    details: DetailsField;
}

/**
 * The fields to show for the picked type.
 *
 * The Vendor shows only once a project is chosen: `Non Project Expenses` has no vendor column, and
 * the server refuses a vendor without a project (`create.guard_vendor_scope`). A type whose form is
 * switched off, or cannot be parsed, asks for a Description, which the server then requires
 * (`create.guard_request_form`). While a form is loading neither is shown, so the Description never
 * flashes up and vanishes.
 */
export const newExpenseFields = ({
    type, projectChosen, formatLoading, formatReady,
}: NewExpenseFieldsInput): NewExpenseFields => {
    if (!type) return { project: "hidden", vendor: false, details: "none" };
    const project: ProjectField = !type.project_allowed
        ? "hidden"
        : type.project_required ? "required" : "optional";
    const details: DetailsField = formatReady
        ? "form"
        : type.has_format && formatLoading ? "loading" : "description";
    return { project, vendor: project !== "hidden" && projectChosen, details };
};

// --- The invoice ("Do you have the invoice?", #1502) -----------------------------------------

/** What Gemini read off the invoice (`invoice_autofill.extract_invoice_fields`); "" = not read. */
export interface InvoiceRead {
    invoice_no: string;
    invoice_date: string;
    amount: string;
}

/** A note beside an invoice field: filled from the invoice, or not read and to be typed. */
export type InvoiceFieldNote = "read" | "unread" | null;

export interface InvoiceNotesInput {
    hasFile: boolean;
    /** What Gemini read; null when the file was not read (not tried, or it failed). */
    read: InvoiceRead | null;
    invoice_date: string;
    invoice_ref: string;
    typedAmount: number;
}

export interface InvoiceNotes {
    date: InvoiceFieldNote;
    number: InvoiceFieldNote;
    /** The invoice's total differs from the typed amount. The amount is never changed. */
    amountMismatch: { invoice: number; typed: number } | null;
    /** How many things to check. None of them stops a submit. */
    count: number;
}

/** A difference of a rupee or less is rounding, as in the Mark-as-Paid dialogs. */
const AMOUNT_TOLERANCE = 1;

const fieldNote = (hasFile: boolean, value: string, readValue: string | undefined): InvoiceFieldNote => {
    if (!hasFile) return null;
    if (!value.trim()) return "unread";
    return readValue && readValue === value ? "read" : null;
};

/** The notes the invoice block shows. Every one is a warning: none blocks submit (#1502). */
export const invoiceNotes = ({
    hasFile, read, invoice_date, invoice_ref, typedAmount,
}: InvoiceNotesInput): InvoiceNotes => {
    const date = fieldNote(hasFile, invoice_date, read?.invoice_date);
    const number = fieldNote(hasFile, invoice_ref, read?.invoice_no);
    const invoiceAmount = Number(read?.amount || 0);
    const amountMismatch = hasFile && invoiceAmount > 0 && typedAmount > 0
        && Math.abs(invoiceAmount - typedAmount) > AMOUNT_TOLERANCE
        ? { invoice: invoiceAmount, typed: typedAmount }
        : null;
    const count = [date === "unread", number === "unread", !!amountMismatch].filter(Boolean).length;
    return { date, number, amountMismatch, count };
};
