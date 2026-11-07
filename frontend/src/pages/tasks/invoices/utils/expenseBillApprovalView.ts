/**
 * Vendor Invoice Recon -> Pending Approval (#1644, spec #1637, GLOSSARY *Expense bill approval*): the pure rules of
 * the four pills and of the Cashbook / Credit Card tables of waiting expense bills.
 *
 * PO and WO are today's table of Vendor Invoices split by document type. Cashbook and Credit Card list the Expense
 * bills waiting for a person (`api/expenses/expense_bill_approval.get_pending_expense_bills`): Pending, the
 * Expense's latest bill, its Bill check done (Matched bills are auto-approved and never wait).
 */
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

/** The pills of Pending Approval. PO and WO carry the Vendor Invoices `document_type` they show. */
export const PENDING_APPROVAL_PILLS = [
    { key: "po", label: "PO", kind: "vendor", documentType: "Procurement Orders" },
    { key: "wo", label: "WO", kind: "vendor", documentType: "Service Requests" },
    { key: "cashbook", label: "Cashbook", kind: "expense" },
    { key: "card", label: "Credit Card", kind: "expense" },
] as const;

export type PendingApprovalPill = (typeof PENDING_APPROVAL_PILLS)[number]["key"];

/** The two pills of expense bills; the value the list endpoint takes as `kind`. */
export type ExpenseBillKind = "cashbook" | "card";

export const isPendingApprovalPill = (value: string): value is PendingApprovalPill =>
    PENDING_APPROVAL_PILLS.some((p) => p.key === value);

/** One Expense bill waiting for a person, as `get_pending_expense_bills` returns it. */
export interface PendingExpenseBillRow {
    /** The Expense bill. */
    name: string;
    expense: string;
    expense_doctype: "Project Expenses" | "Non Project Expenses";
    /** The spend date. */
    payment_date: string;
    /** The amount of the statement line the bill was compared against. */
    line_amount: number;
    /** The bill's total (incl. GST) the reader found; null unless the bill was compared (Matched / Mismatched). */
    read_total: number | null;
    bill_check: "Matched" | "Mismatched" | "Not read" | "Not checked";
    bill_check_reason: string | null;
    /** The number and date to approve with: the bill's own, else what was typed on the Expense. */
    invoice_no: string | null;
    invoice_date: string | null;
    /** The wallet holder or the card holder. */
    paid_by: string | null;
    project: string | null;
    project_name: string | null;
    /** Who attached the bill, and their full name. */
    uploaded_by: string | null;
    uploaded_by_name: string | null;
    bill_file: string;
}

/** The Bill check as one sentence: the result, then its reason when it has one. */
export const billCheckText = (row: Pick<PendingExpenseBillRow, "bill_check" | "bill_check_reason">): string =>
    row.bill_check_reason ? `${row.bill_check}: ${row.bill_check_reason}` : row.bill_check;

/** The total read, or a dash when the bill was not compared. */
export const readTotalText = (row: Pick<PendingExpenseBillRow, "read_total">): string =>
    row.read_total === null || row.read_total === undefined ? "--" : formatToRoundedIndianRupee(row.read_total);

/** What the approve form starts from; a person corrects it before approving. */
export const approveFormDefaults = (row: Pick<PendingExpenseBillRow, "invoice_no" | "invoice_date">) => ({
    invoice_no: row.invoice_no ?? "",
    invoice_date: row.invoice_date ?? "",
});

/** The line a spend back in Pending Invoices Upload shows when its latest bill was rejected; null otherwise. */
export const lastBillRejectedText = (reason: string | null | undefined): string | null =>
    reason ? `Last bill rejected: ${reason}` : null;
