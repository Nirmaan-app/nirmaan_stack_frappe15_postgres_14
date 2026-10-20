// Expense Request — the ask a requester raises. An APPROVED request creates the real
// Project Expenses / Non Project Expenses row, which carries `request_id` back to it; the
// request itself never appears in any financial rollup.
//
// Once a request has an Expense, its `status` MIRRORS that Expense (`expense_request_status`,
// #1500): Rejected when the Expense is rejected, Paid when it is paid, Approved otherwise. The
// finer step and the live amount are read from the Expense through `get_request_standing`.

import type { PayToAccount } from "./Payee";

export type ExpenseRequestStatus = "Pending Approval" | "Approved" | "Rejected" | "Paid";

/** One step of the request page's "Where it stands" (`services/expense_standing.where_it_stands`). */
export interface StandingStep {
  key: "raised" | "review" | "admin" | "ceo" | "paid";
  label: string;
  state: "done" | "current" | "upcoming" | "rejected";
  /** A user id, or null. */
  by: string | null;
  /** A date or datetime string, or null. */
  on: string | null;
  note: string | null;
}

/** The Expense a request created, as `standing.expenses_of` reads it. */
export interface RequestExpense {
  doctype: "Project Expenses" | "Non Project Expenses";
  name: string;
  status: string;
  amount: number;
}

/** Where one request stands, LIVE from its Expense (`api/expense_requests/standing`). */
export interface RequestStanding {
  /** The label to show: the Expense's status ("Waiting for Admin", "CEO Pending", ...) once it
   *  exists, else the request's own. */
  status: string;
  /** The Expense's amount once it exists (Accounts may have corrected it), else the request's. */
  amount: number;
  expense: RequestExpense | null;
  steps: StandingStep[];
}

export type GetRequestStandingResponse = Record<string, RequestStanding>;

/** Another stay for the same person on overlapping dates (`duplicates.find_stay_duplicates`, #1504).
 *  One per request; `expense` is the Expense it became, if any. Never a refusal. */
export interface StayDuplicate {
  request: string;
  /** The live label: the Expense's status once there is one, else the request's. */
  status: string;
  expense: { doctype: string; name: string; status: string } | null;
  type: string;
  projects: string | null;
  project_name: string | null;
  amount: number;
  /** The name as it was typed on that request. */
  person: string;
  period_from: string;
  period_to: string;
  owner_name: string;
  creation: string;
  detail: { label: string; value: string }[];
}

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
  /** 1 when its raiser records without review (#1498): approved on submit, with no Reviewer. */
  approved_on_submit?: 0 | 1;
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

/** `invoice.add_request_invoice`'s reply: the invoice now held, the Expense it was copied to. */
export interface AddRequestInvoiceResponse {
  name: string;
  invoice: ExpenseRequestInvoice;
  expense: string | null;
  warnings: string[];
}

/** `create.create_expense_request` and `update.update_expense_request`'s reply. The three expense
 *  fields come from create only, and are null while the request waits for review. */
export interface SaveExpenseRequestResponse {
  name: string;
  status: ExpenseRequestStatus;
  projects: string | null;
  created_expense?: string | null;
  created_expense_doctype?: string | null;
  expense_status?: string | null;
  warnings: string[];
  duplicates: StayDuplicate[];
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
  /** Why the caller may not add it now, or null when they may (`invoice.invoice_refusal`). */
  invoice_refusal: string | null;
  can_edit: boolean;
  /** Live from the Expense (#1500): the status label and amount to show, and "Where it stands". */
  standing: Omit<RequestStanding, "expense">;
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
  /** The caller records without review (#1498): their request is approved on submit. */
  records_without_review?: boolean;
}
