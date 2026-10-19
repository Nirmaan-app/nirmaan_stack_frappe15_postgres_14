// Expense Request — the ask a requester raises. An APPROVED request creates the real
// Project Expenses / Non Project Expenses row, which carries `request_id` back to it; the
// request itself never appears in any financial rollup.
//
// `Paid` is set by the LEDGER, through the on_update hook that fires when the expense row is
// paid — never by a reviewer, and there is no endpoint that sets it.

import type { PayToAccount } from "./Payee";

export type ExpenseRequestStatus = "Pending Approval" | "Approved" | "Rejected" | "Paid";

export interface ExpenseRequest {
  name: string;
  type: string;
  /** Set => Project expense. Blank => Non-Project. There is no `expense_kind` field. */
  projects?: string | null;
  /** Injected by the data-table layer from `LINK_FIELD_MAP` (projects -> Projects.project_name).
   *  Present on table reads; ABSENT on the scoped endpoint, which is a plain `get_list`. */
  projects_name?: string | null;
  amount: number;
  /** Optional, and PROJECT-ONLY -- `Non Project Expenses` has no vendor column, so a
   *  vendor on a non-project request would be dropped at approval. */
  vendor?: string | null;
  comment?: string | null;
  /** Answers to the type's source_format, JSON. Null when the type declares no format. */
  source_data?: string | null;
  status: ExpenseRequestStatus;
  reviewed_by?: string | null;
  reviewed_on?: string | null;
  review_comment?: string | null;
  owner: string;
  creation: string;
  modified: string;

  // --- server-derived, NOT stored ---
  request_category: string | null;
  reviewer_role: string;
  /** Whether THIS caller may action THIS row. Server-computed — never re-derive it. */
  can_review: boolean;
  /** Whether THIS caller may edit THIS row — server-computed, and DISJOINT from
   *  `can_review`. Never re-derive it. */
  can_edit?: boolean;
  /** Whether THIS caller may delete THIS row: Rejected, its raiser or an Admin, and no Expense
   *  linked. Server-computed (`delete.can_delete`). Never re-derive it. */
  can_delete?: boolean;
  /** The format answers, labelled. Built by the SAME walk that writes the ledger
   *  description, so the approval screen and the expense cannot describe it differently. */
  detail?: { label: string; value: string }[];
  /** Which ledger approval will write to. Resolved server-side, not re-derived here. */
  target_doctype?: string;
  /** What status the ledger row will be BORN at if THIS caller approves it — server-resolved,
   *  because it depends on the amount, the raiser and whether the caller is L1 (an Admin's review
   *  is the L1 step, #1499). Never re-derive it here. */
  target_status?: "Approved" | "Requested" | "CEO Pending";
  /** Who gets paid (ADR-0033, #1436): the request's own pay-to account, copied from the Payee picked
   *  or the vendor's Payee; approval copies it onto the Expense as it is. Null when it has none. */
  pay_to?: PayToAccount | null;
  /** Its type's Who gets paid: Required / Optional / Not asked (`utils/payees/expensePayee`). */
  payee_rule?: string;
}

/** An expense's invoice (#1502): only the parts given. */
export interface ExpenseRequestInvoice {
  invoice_attachment?: string;
  invoice_date?: string;
  invoice_ref?: string;
}

/** One request, for its page (`read.get_expense_request`). */
export interface ExpenseRequestDetail {
  name: string;
  type: string;
  projects?: string | null;
  projects_name?: string | null;
  amount: number;
  vendor?: string | null;
  comment?: string | null;
  source_data?: string | null;
  status: ExpenseRequestStatus;
  owner: string;
  owner_name: string;
  creation: string;
  review_comment?: string | null;
  /** The answers, labelled by the request's form; the invoice is in `invoice`. */
  detail: { label: string; value: string }[];
  pay_to?: PayToAccount | null;
  /** The Expense created from it; null before approval. */
  expense: { doctype: string; name: string; status: string } | null;
  invoice: ExpenseRequestInvoice;
  /** Server-computed (`invoice.invoice_refusal`): the raiser or an Admin, until the Expense is Paid. */
  can_add_invoice: boolean;
  can_edit: boolean;
}

export interface GetMyExpenseRequestsResponse {
  role_profile: string | null;
  requests: ExpenseRequest[];
}

export interface RequestCatalogType {
  expense_type: string;
  project: boolean;
  non_project: boolean;
  /** project-only => the Project field is required */
  project_required: boolean;
  /** false => the Project field is hidden entirely */
  project_allowed: boolean;
  /** True only when the type's "Enable Source" switch is ON and a format is written.
   *  False => the dialog asks the standard fields. */
  has_format: boolean;
  /** Who gets paid: Required / Optional / Not asked (`utils/payees/expensePayee`). */
  payee_rule: string;
}

export interface RequestCatalogCategory {
  category: string;
  reviewer_role: string | null;
  types: RequestCatalogType[];
}

export interface GetRequestCatalogResponse {
  categories: RequestCatalogCategory[];
}
