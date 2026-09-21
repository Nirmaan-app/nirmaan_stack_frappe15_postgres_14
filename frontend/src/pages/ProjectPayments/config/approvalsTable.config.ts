/**
 * Unified approval queue — tabs, and which columns each one carries.
 *
 * The three money-out ledgers (Project Payments, Project Expenses, Non Project
 * Expenses) stay separate doctypes. What unifies is the queue: one amount rule,
 * one status field, one screen.
 */

import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { PP_TABS, PPTabValue } from "./ppTabs.constants";

export const APPROVAL_QUEUE_API =
  "nirmaan_stack.api.approvals.get_approval_queue.get_approval_queue";
export const APPROVAL_COUNTS_API =
  "nirmaan_stack.api.approvals.get_approval_queue.get_approval_queue_counts";
/** SWR key of the tab-badge fetch — shared so a child tab can refresh the badges. */
export const APPROVAL_COUNTS_SWR_KEY = "approval-queue-counts";

/** The five statuses in sequence, plus the end state. `Paid` means RECONCILED. */
export const APPROVAL_STATUS = {
  REQUESTED: "Requested",
  CEO_PENDING: "CEO Pending",
  APPROVED: "Approved",
  RECONCILIATION_PENDING: "Reconciliation Pending",
  PAID: "Paid",
  REJECTED: "Rejected",
} as const;

/**
 * ⚠️ THE TABS ARE `PP_TABS` — there is deliberately no second tab vocabulary.
 *
 * A tab VALUE is load-bearing in eight backend notification deep links, in the
 * tab->status filter switch, in every URL-sync key and in a dozen
 * `tab === "Payments Done"` comparisons. The owner renamed the visible LABELS on
 * 2026-09-15 and every value stayed byte-identical for exactly that reason.
 *
 * So this file describes COLUMNS for the tabs that already exist; it does not
 * define tabs.
 */
export type ApprovalTab = PPTabValue;

/**
 * ⚠️ THERE IS NO "select" COLUMN HERE, DELIBERATELY.
 *
 * `DataTable` renders the row-selection checkbox itself — its own <col> AND its
 * own <TableHead> — gated on `showRowSelection`. Declaring one here too puts an
 * extra <col> in the colgroup, and since the table is `table-fixed` every column
 * then renders with the PREVIOUS column's width: Actions collapses to 40px and
 * Vendor overflows into Project. Measured in the browser, not theorised.
 * Control selection through `showRowSelection` + `enableRowSelection` instead.
 */
export type ApprovalColumnId =
  | "actions" | "source" | "against" | "requested_on"
  | "vendor" | "project" | "amount" | "tier" | "raised_by"
  | "approved_on" | "paid_on" | "utr_ref" | "proof" | "payment_by"
  | "reconciled_on" | "status" | "project_value" | "cashflow_gap";

/** One row of the union endpoint. Every field is NORMALIZED — no cell branches on ledger. */
export interface ApprovalQueueRow {
  name: string;
  source: "Vendor Payment" | "Project Expense" | "Non-Project";
  /**
   * What the Type column shows and filters on — `source` with a vendor payment split by
   * its parent. Display + filter ONLY: every ledger branch keeps reading `source`.
   * "Vendor Payment" survives here only as the server's fallback for an unrecognised parent.
   */
  source_type: "PO Payment" | "SR Payment" | "Vendor Payment" | "Project Expense" | "Non-Project";
  doctype: "Project Payments" | "Project Expenses" | "Non Project Expenses";
  status: string;
  amount: number;
  against_primary: string;
  /** Line 2 under Against — the expense TYPE. Blank on a payment. */
  against_secondary: string;
  /** The expense comment. Hover only — see the Against cell. */
  comment_text: string;
  against_full: string;
  vendor: string;
  project: string;
  raised_by: string;
  creation: string;
  approved_on: string | null;
  paid_on: string | null;
  utr_ref: string;
  proof: string;
  has_proof: boolean;
  payment_by: string;
  against_type: string;
  expense_type: string;
  reconciled_on: string | null;
  auto_approved: number;
  /**
   * How many live bank lines settle this expense (ADR-0027 R5, #1303). Always 0 on a payment —
   * a payment is settled by exactly one line and has no Bank lines card.
   *
   * ⚠️ IT DECIDES ONLY WHETHER THE Against CELL OFFERS THE CARD. The lines themselves are fetched
   * lazily on open, so an expense no line has reached shows no trigger and costs no query.
   */
  bank_line_count: number;
  tier: "auto" | "l1" | "l1_l2";
  /**
   * Kept under their PAYMENT names deliberately. The bulk-approve engine and the
   * action dialogs read exactly five fields off a row — amount, name,
   * document_name, vendor, document_type — so carrying these makes the
   * normalized row a SUPERSET of what already works, and neither
   * `useBulkPaymentActions` nor `PaymentActionDialog` needs any change.
   * Blank on an expense: it has no PO/SR parent and never withholds tax.
   */
  document_name: string;
  document_type: string;
  /** A payment's Mode of Payment; blank on an expense (and on a payment from before the field). */
  mode_of_payment: string;
  cheque_no: string;
  cheque_date: string | null;
}

/**
 * THE SPEC. Each array IS the column order — which is how `actions` sits second,
 * so the approver's hand never travels to the right edge and the button stays put
 * as the other columns change between tabs.
 *
 * Adding a tab is one entry here, not another 300-line column block. Changing a
 * column changes it on every tab at once, because there is only one of it.
 */
export const TAB_COLUMNS: Record<ApprovalTab, ApprovalColumnId[]> = {
  // "Payment Pending Approval" — `tier` was removed from the screen by owner request;
  // it is still written to the CSV export (approvalExportColumns.ts).
  [PP_TABS.APPROVE_PAYMENTS]: [
    "actions", "source", "against", "requested_on",
    "vendor", "project", "amount", "raised_by",
  ],
  // "Payment Pending CEO Approval" — no `tier`: every row here is L1+L2 by
  // definition, so it would be one word repeated down the page. The two CEO-only
  // figures take those slots instead.
  [PP_TABS.CEO_PENDING]: [
    "actions", "source", "against", "requested_on",
    "vendor", "project", "amount", "project_value", "cashflow_gap",
  ],
  // "Payment need to paid"
  [PP_TABS.NEW_PAYMENTS]: [
    "actions", "source", "against", "vendor",
    "project", "amount", "approved_on", "raised_by",
  ],
  // "Payment Done / Reconciliation Pending" — `payment_by` earns its place here:
  // 99.5% filled on project expenses and homeless otherwise.
  [PP_TABS.RECONCILIATION_PENDING]: [
    "actions", "source", "against", "vendor", "project",
    "amount", "paid_on", "utr_ref", "proof", "payment_by",
  ],
  // "Payment Done / Reconciliation Done" — no `select`, no `actions`: there is
  // nothing left to do to a settled row. The admin Edit pencil that used to sit
  // here was removed by owner request (2026-09-17).
  [PP_TABS.PAYMENTS_DONE]: [
    "source", "against", "vendor", "project", "amount", "paid_on",
    "utr_ref", "proof", "reconciled_on", "payment_by",
  ],
  // Mixed-status tabs are the only ones that show `status`, because they are the
  // only ones where it varies. No bulk action is valid across a mixed selection.
  [PP_TABS.PAYMENTS_PENDING]: [
    "source", "against", "vendor", "project", "amount", "status",
    "requested_on", "raised_by",
  ],
  [PP_TABS.ALL_PAYMENTS]: [
    "source", "against", "vendor", "project", "amount", "status",
    "requested_on", "raised_by",
  ],
  // "Payment By Me" — `actions` holds ONLY a Delete, on REJECTED rows only, "--" on the rest
  // (owner, 17 Sep 2026). Its dialog deletes an expense after a confirm; for a PO / SR payment
  // it links to the PO / SR page, whose own payment table does the delete. No `raised_by` for most users, since every
  // row is their own; an Admin sees EVERY row here, and AllPayments appends `raised_by`.
  [PP_TABS.PAYMENT_BY_ME]: [
    "actions", "source", "against", "vendor", "project", "amount", "status", "requested_on",
  ],
  // PO Wise groups by PO, so it is payments-only and keeps its own rendering.
  [PP_TABS.PO_WISE]: [
    "source", "against", "vendor", "project", "amount", "status",
  ],
};

/** Paid and All are mixed or finished — no single bulk action is valid there. */
export const TAB_ALLOWS_SELECTION: Record<ApprovalTab, boolean> = {
  [PP_TABS.APPROVE_PAYMENTS]: true,
  [PP_TABS.CEO_PENDING]: true,
  [PP_TABS.NEW_PAYMENTS]: true,
  [PP_TABS.RECONCILIATION_PENDING]: true,
  [PP_TABS.PAYMENTS_DONE]: false,
  [PP_TABS.PAYMENTS_PENDING]: false,
  [PP_TABS.ALL_PAYMENTS]: false,
  [PP_TABS.PO_WISE]: false,
  [PP_TABS.PAYMENT_BY_ME]: false,
};

/**
 * Every tab opens NEWEST-FIRST (owner, 2026-09-16).
 *
 * ⚠️ THE FIELDS ARE PER TAB ON PURPOSE — the pay queue sorts on `approved_on` and
 * the two settled tabs on `paid_on`, the date of their OWN step.
 *
 * Payment Pending Approval, Payment Pending CEO Approval, Payments Pending and
 * Payment Raised By Me sort on `modified` (owner, 2026-09-21), so a row that was
 * just edited rises to the top. `modified` is exposed by the union in
 * get_approval_queue.py and allowlisted in its SORTABLE set.
 *
 * The three work queues used to open OLDEST-first, to surface the rows that had
 * been waiting longest. The owner reversed that: the rows people act on are the
 * ones that just arrived, and the oldest-first view buried every new request
 * behind a backlog that is worked from its own filters instead.
 */
export const TAB_DEFAULT_SORT: Record<ApprovalTab, string> = {
  [PP_TABS.APPROVE_PAYMENTS]: "modified desc",
  [PP_TABS.CEO_PENDING]: "modified desc",
  [PP_TABS.NEW_PAYMENTS]: "approved_on desc",
  [PP_TABS.RECONCILIATION_PENDING]: "paid_on desc",
  [PP_TABS.PAYMENTS_DONE]: "paid_on desc",
  [PP_TABS.PAYMENTS_PENDING]: "modified desc",
  [PP_TABS.ALL_PAYMENTS]: "creation desc",
  [PP_TABS.PO_WISE]: "creation desc",
  [PP_TABS.PAYMENT_BY_ME]: "modified desc",
};

/**
 * "Payment By Me": all statuses, rows the logged-in user created — EVERY row for an Admin.
 * `@me` is resolved ON THE SERVER (`CURRENT_USER_TOKEN` in get_approval_queue.py), so the
 * browser never names whose rows it gets.
 */
export const CURRENT_USER_TOKEN = "@me";

/**
 * ⚠️ EVERY TAB NEEDS AN EXPLICIT CASE.
 *
 * The payments version of this switch falls through to `default: []` — i.e. NO
 * status filter — so a missing case shows every row in the system while the tab
 * label claims otherwise. That has already happened once on this codebase.
 * `default` therefore throws rather than returning an unfiltered list.
 */
export const getApprovalsStaticFilters = (
  tab: ApprovalTab,
): Array<[string, string, string | string[]]> => {
  switch (tab) {
    case PP_TABS.APPROVE_PAYMENTS:
      return [["status", "=", APPROVAL_STATUS.REQUESTED]];
    case PP_TABS.CEO_PENDING:
      return [["status", "=", APPROVAL_STATUS.CEO_PENDING]];
    case PP_TABS.NEW_PAYMENTS:
      return [["status", "=", APPROVAL_STATUS.APPROVED]];
    case PP_TABS.RECONCILIATION_PENDING:
      return [["status", "=", APPROVAL_STATUS.RECONCILIATION_PENDING]];
    case PP_TABS.PAYMENTS_DONE:
      return [["status", "=", APPROVAL_STATUS.PAID]];
    case PP_TABS.PAYMENTS_PENDING:
      return [["status", "in", [
        APPROVAL_STATUS.REQUESTED,
        APPROVAL_STATUS.CEO_PENDING,
        APPROVAL_STATUS.APPROVED,
      ]]];
    case PP_TABS.ALL_PAYMENTS:
    case PP_TABS.PO_WISE:
      return [];
    case PP_TABS.PAYMENT_BY_ME:
      return [["raised_by", "=", CURRENT_USER_TOKEN]];
    default: {
      // ⚠️ NOT a fall-through to []. The payments version of this switch returns
      // an unfiltered list on an unknown tab, so a missing case shows EVERY row in
      // the system while the tab label claims otherwise. `never` makes a new tab
      // without a filter a COMPILE error instead of a silent one.
      const unreachable: never = tab;
      throw new Error(`No status filter defined for tab: ${unreachable}`);
    }
  }
};

export const buildApprovalsUrlSyncKey = (tab: ApprovalTab): string =>
  `approvals_${tab.toLowerCase().replace(/\s+/g, "_")}`;

export const APPROVAL_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  { value: "against_primary", label: "PO / SR / Description", placeholder: "Search PO, SR or description...", default: true },
  { value: "vendor", label: "Vendor", placeholder: "Search by Vendor ID..." },
  { value: "project", label: "Project", placeholder: "Search by Project ID..." },
  { value: "raised_by", label: "Raised by", placeholder: "Search by requester..." },
  { value: "utr_ref", label: "UTR / Ref", placeholder: "Search by UTR or payment reference..." },
  { value: "cheque_no", label: "Cheque No", placeholder: "Search by cheque number..." },
  { value: "name", label: "Record ID", placeholder: "Search by record ID..." },
];

/** The union endpoint fixes its own shape; this is sent only to satisfy the hook. */
export const APPROVAL_FETCH_FIELDS = ["name", "status", "amount", "source"];

/**
 * The date columns the UNION exposes — not the doctype's.
 *
 * ⚠️ The payments list used `["creation","modified","payment_date","approval_date"]`.
 * Three of those do not exist on a queue row, and the endpoint refuses an unknown
 * filter field rather than ignoring it, so leaving them in makes the date control
 * throw the moment it is used.
 */
export const APPROVAL_DATE_COLUMNS = ["creation", "approved_on", "paid_on"];

export const TIER_LABEL: Record<ApprovalQueueRow["tier"], string> = {
  auto: "AUTO",
  l1: "L1",
  l1_l2: "L1+L2",
};

/**
 * What the Source column READS. These are labels only — the stored values stay
 * "Vendor Payment" / "Project Expense" / "Non-Project", which is what the facet
 * filter and the endpoint match on.
 */
export const SOURCE_LABEL: Record<ApprovalQueueRow["source"], string> = {
  "Vendor Payment": "Payment",
  "Project Expense": "Project Expense",
  "Non-Project": "Non Project Expense",
};

const SOURCE_BADGE_BASE: Record<ApprovalQueueRow["source"], string> = {
  "Vendor Payment": "bg-sky-50 text-sky-700 ring-sky-200",
  "Project Expense": "bg-violet-50 text-violet-700 ring-violet-200",
  "Non-Project": "bg-amber-50 text-amber-800 ring-amber-200",
};

/** What the Type column READS. Stored values are what the facet filter and the endpoint match on. */
export const TYPE_LABEL: Record<ApprovalQueueRow["source_type"], string> = {
  "PO Payment": "PO Payment",
  "SR Payment": "SR Payment",
  "Vendor Payment": "Payment",
  "Project Expense": "Project Expense",
  "Non-Project": "Non Project Expense",
};

/** The Type filter's options. The "Vendor Payment" fallback is left out: no row carries it today. */
export const TYPE_FILTER_VALUES: ApprovalQueueRow["source_type"][] = [
  "PO Payment", "SR Payment", "Project Expense", "Non-Project",
];

export const TYPE_BADGE: Record<ApprovalQueueRow["source_type"], string> = {
  "PO Payment": SOURCE_BADGE_BASE["Vendor Payment"],
  "SR Payment": "bg-teal-50 text-teal-700 ring-teal-200",
  "Vendor Payment": SOURCE_BADGE_BASE["Vendor Payment"],
  "Project Expense": SOURCE_BADGE_BASE["Project Expense"],
  "Non-Project": SOURCE_BADGE_BASE["Non-Project"],
};

/**
 * Line 1 of an expense description — the one thing that identifies the row.
 *
 * ⚠️ NEVER RENDER A RAW LINE BREAK IN A ROW. 35% of project-expense descriptions
 * carry one, and those extra lines are BANK DETAILS, not description — 911 rows
 * would break the row height. The full text belongs in a hover or a title.
 *
 * Callers add their own width cap: the Against column truncates at 40 characters
 * (98.6% of first lines fit), the bulk dialog lets CSS do it.
 */
export const descriptionFirstLine = (text?: string): string =>
  (text || "").split("\n")[0].trim();

/** One soft badge per ledger, so the three read apart at a glance. */
export const SOURCE_BADGE: Record<ApprovalQueueRow["source"], string> = SOURCE_BADGE_BASE;
