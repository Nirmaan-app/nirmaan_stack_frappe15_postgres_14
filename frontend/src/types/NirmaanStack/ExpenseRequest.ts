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
  /** What status the ledger row will be BORN at — server-resolved, because it depends on the
   *  amount and the threshold lives on the ledger doctypes. Never re-derive it here. */
  target_status?: "Approved" | "Requested";
  /** Who gets paid (ADR-0033, #1436): the request's own pay-to account, copied from the Payee picked
   *  or the vendor's Payee; approval copies it onto the Expense as it is. Null when it has none. */
  pay_to?: PayToAccount | null;
  /** Its type's Who gets paid: Required / Optional / Not asked (`utils/payees/expensePayee`). */
  payee_rule?: string;
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
