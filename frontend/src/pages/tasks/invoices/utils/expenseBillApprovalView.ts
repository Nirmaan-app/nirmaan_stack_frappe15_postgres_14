/**
 * Vendor Invoice Recon -> Pending Approval (#1644, spec #1637, GLOSSARY *Expense bill approval*): the pure rules of
 * the Cashbook / Credit Card tables of waiting expense bills (its pills are `reconPills`).
 *
 * Cashbook and Credit Card list the Expense bills waiting for a person
 * (`api/expenses/expense_bill_approval.get_pending_expense_bills`): Pending, the Expense's latest bill, its Bill check
 * done (Matched bills are auto-approved and never wait).
 */
import { NOT_SET_FACET_VALUE } from "@/components/data-table/facetConfig";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { BillCheck } from "@/types/NirmaanStack/ExpenseBill";

/** The two pills of expense bills; the value the list endpoint takes as `kind`. */
export type ExpenseBillKind = "cashbook" | "card";

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
    /** A waiting bill's Bill check is done: every result but Checking. */
    bill_check: Exclude<BillCheckResult, "Checking">;
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
export const billCheckText = (row: { bill_check: BillCheckResult; bill_check_reason: string | null }): string =>
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

/** A Bill check result (GLOSSARY *Bill check*); Checking while the reading runs. */
export const BILL_CHECK_RESULTS = [
    "Checking",
    "Matched",
    "Mismatched",
    "Not read",
    "Not checked",
] as const satisfies readonly BillCheck[];
export type BillCheckResult = (typeof BILL_CHECK_RESULTS)[number];

/** An Expense bill's approval as the lists show it: a Matched bill the system approved is Auto-approved. */
export const BILL_APPROVAL_STATUSES = ["Auto-approved", "Pending", "Approved", "Rejected"] as const;
export type BillApprovalStatus = (typeof BILL_APPROVAL_STATUSES)[number];

/**
 * The Project Expenses and Non-Project Expenses lists (#1640): an Expense's Bill check is its latest Expense bill's,
 * as the list endpoint fills it (`services/expense_bills/bill_list.py`); null on an Expense with no Expense bill
 * (its bill came before launch, or it has none).
 */
export interface ExpenseListBillCheckFields {
    bill_check?: BillCheckResult | null;
    bill_approval?: BillApprovalStatus | null;
}

/** The cell of an Expense with no Expense bill. */
export const NO_EXPENSE_BILL_TEXT = "—";

export const expenseListBillCheck = (
    row: ExpenseListBillCheckFields,
): { result: BillCheckResult; approval: BillApprovalStatus } | null =>
    row.bill_check && row.bill_approval ? { result: row.bill_check, approval: row.bill_approval } : null;

/** The Bill check as one line of text (the export, a hover title). */
export const expenseListBillCheckText = (row: ExpenseListBillCheckFields): string => {
    const shown = expenseListBillCheck(row);
    return shown ? `${shown.result} · ${shown.approval}` : NO_EXPENSE_BILL_TEXT;
};

/** The "no Expense bill" choice: the data table's "not set" value, which the list endpoint reads as no bill. */
const NO_BILL_OPTION = { label: `${NO_EXPENSE_BILL_TEXT} (no bill)`, value: NOT_SET_FACET_VALUE };

export const BILL_CHECK_FILTER_OPTIONS = [...BILL_CHECK_RESULTS.map((v) => ({ label: v, value: v })), NO_BILL_OPTION];
export const BILL_APPROVAL_FILTER_OPTIONS = [...BILL_APPROVAL_STATUSES.map((v) => ({ label: v, value: v })), NO_BILL_OPTION];
