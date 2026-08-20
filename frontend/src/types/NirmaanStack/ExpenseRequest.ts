// Expense Request — the ask a requester raises. An APPROVED request creates the real
// Project Expenses / Non Project Expenses row, which carries `request_id` back to it; the
// request itself never appears in any financial rollup.
//
// `Paid` is set by the LEDGER, through the on_update hook that fires when the expense row is
// paid — never by a reviewer, and there is no endpoint that sets it.

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
  /** The format answers, labelled. Built by the SAME walk that writes the ledger
   *  description, so the approval screen and the expense cannot describe it differently. */
  detail?: { label: string; value: string }[];
  /** Which ledger approval will write to. Resolved server-side, not re-derived here. */
  target_doctype?: string;
  /** What status the ledger row will be BORN at — server-resolved, because it depends on the
   *  amount and the threshold lives on the ledger doctypes. Never re-derive it here. */
  target_status?: "Approved" | "Requested";
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
  has_format: boolean;
}

export interface RequestCatalogCategory {
  category: string;
  reviewer_role: string | null;
  types: RequestCatalogType[];
}

export interface GetRequestCatalogResponse {
  categories: RequestCatalogCategory[];
}
