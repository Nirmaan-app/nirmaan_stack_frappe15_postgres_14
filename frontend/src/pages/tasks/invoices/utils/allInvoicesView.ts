/**
 * Vendor Invoice Recon -> All Invoices (#1646, spec #1637, GLOSSARY *Expense bills*): the pure rules of its pills
 * and of the Cashbook / Credit Card / Porter tables.
 *
 * PO and WO are today's table of Vendor Invoices split by document type. Cashbook and Credit Card list every Expense
 * bill, latest and history (`api/expenses/all_expense_bills.get_all_expense_bills`); Porter lists one row per Porter
 * Invoice with its Validate result (`api/invoices/all_porter_invoices.get_all_porter_invoices`). Those three are for
 * the Vendor Invoice approvers only (Admin, Accountant, Accountant Lead), as the server checks.
 */
import { canActionInvoiceApprovals } from "@/constants/roles";

import type { BillApprovalStatus, BillCheckResult } from "./expenseBillApprovalView";

export const ALL_INVOICES_PILLS = [
    { key: "po", label: "PO", kind: "vendor", documentType: "Procurement Orders" },
    { key: "wo", label: "WO", kind: "vendor", documentType: "Service Requests" },
    { key: "cashbook", label: "Cashbook", kind: "expense" },
    { key: "card", label: "Credit Card", kind: "expense" },
    { key: "porter", label: "Porter", kind: "porter" },
] as const;

export type AllInvoicesPill = (typeof ALL_INVOICES_PILLS)[number];
export type AllInvoicesPillKey = AllInvoicesPill["key"];

export const isAllInvoicesPill = (value: string): value is AllInvoicesPillKey =>
    ALL_INVOICES_PILLS.some((p) => p.key === value);

/** The pills `role` sees: PO and WO for everyone who sees All Invoices; the rest for the approvers only. */
export const allInvoicesPillsFor = (role?: string | null, userId?: string | null): AllInvoicesPill[] => {
    const approver = canActionInvoiceApprovals(role, userId);
    return ALL_INVOICES_PILLS.filter((p) => p.kind === "vendor" || approver);
};

/** One Expense bill, as `get_all_expense_bills` returns it. */
export interface AllExpenseBillRow {
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
    bill_check: BillCheckResult;
    bill_check_reason: string | null;
    approval: BillApprovalStatus;
    rejection_reason: string | null;
    /** Who approved the bill (a user id; "System" on an Auto-approved bill) and when. */
    approved_by: string | null;
    approved_on: string | null;
    /** Who rejected the bill (a user id) and when. */
    rejected_by: string | null;
    rejected_on: string | null;
    /** 1 on the Expense's latest bill, 0 on one a newer bill replaced. */
    is_latest: 0 | 1;
    invoice_no: string | null;
    invoice_date: string | null;
    /** The wallet holder or the card holder. */
    paid_by: string | null;
    project: string | null;
    project_name: string | null;
    uploaded_by: string | null;
    uploaded_by_name: string | null;
    bill_file: string;
    creation: string;
}

/** The approval as one line: a rejected bill's reason follows its status. */
export const approvalText = (row: Pick<AllExpenseBillRow, "approval" | "rejection_reason">): string =>
    row.approval === "Rejected" && row.rejection_reason ? `Rejected: ${row.rejection_reason}` : row.approval;

type BillDecisionFields = Pick<AllExpenseBillRow, "approval" | "approved_by" | "approved_on" | "rejected_by" | "rejected_on">;

/** Who decided the bill and when: the approver of an Approved or Auto-approved bill, whoever rejected a Rejected one;
 *  null on a Pending bill, or a decided one that records no decider. */
export const billDecision = (row: BillDecisionFields): { by: string; on: string } | null => {
    const [by, on] = row.approval === "Rejected" ? [row.rejected_by, row.rejected_on]
        : row.approval === "Pending" ? [null, null]
        : [row.approved_by, row.approved_on];
    return by && on ? { by, on } : null;
};

/** Read again reaches an Expense's latest bill whose Bill check is Not read, unless it was rejected (GLOSSARY
 *  *Read again*); the server checks it too (`read_expense_bill_again`). */
export const offersReadAgain = (row: Pick<AllExpenseBillRow, "bill_check" | "is_latest" | "approval">): boolean =>
    row.bill_check === "Not read" && !!row.is_latest && row.approval !== "Rejected";

/** Latest bill of its Expense, or one a newer bill replaced. */
export const BILL_HISTORY_OPTIONS = [
    { label: "Latest", value: "1" },
    { label: "Replaced", value: "0" },
];

/** A Porter Invoice's Validate result (its `validation_status`). */
export const PORTER_VALIDATION_STATUSES = ["Queued", "Downloading", "Reading", "Comparing", "Passed", "Failed", "Error"] as const;

/** One Porter Invoice, as `get_all_porter_invoices` returns it; its name is Porter's invoice number. */
export interface PorterInvoiceListRow {
    name: string;
    import_batch: string | null;
    validation_status: (typeof PORTER_VALIDATION_STATUSES)[number] | null;
    validation_message: string | null;
    city: string | null;
    completed_orders: number | null;
    read_invoice_date: string | null;
    fare_total: number | null;
    tax_total: number | null;
    invoice_total: number;
    /** Null until its PDF arrived. */
    invoice_file: string | null;
    creation: string;
}

/** The Validate result as one line: the result, then its message when it has one. */
export const porterResultText = (row: Pick<PorterInvoiceListRow, "validation_status" | "validation_message">): string =>
    row.validation_message ? `${row.validation_status ?? ""}: ${row.validation_message}` : row.validation_status ?? "";
