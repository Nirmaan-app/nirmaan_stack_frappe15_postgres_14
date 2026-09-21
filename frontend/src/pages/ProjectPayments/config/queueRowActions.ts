/**
 * Who may edit or revert a row on the Payments queue tabs (owner, 2026-09-21).
 *
 * ONE rule for every tab — Payment Pending Approval, CEO Pending, Payment need to paid,
 * Reconciliation Pending, Payment Done, Payments Pending, Payment Raised By Me, and the
 * project / customer Financials tables — so the pencil can never appear on one tab and not
 * another for the same row.
 *
 *   PO / WO payment        no edit in any status; Reconciliation Pending → "Revert to Approved"
 *   Project / Non-Project  edit in Requested, CEO Pending, Approved, Reconciliation Pending and
 *   expense                Paid — on a Paid row Amount, Payment Date and Payment Ref are read-only
 *
 * ⚠️ THE PAID-EXPENSE LOCK IS THIS SCREEN'S ONLY. The server deliberately does not enforce it
 * (the owner still corrects Paid expenses in Desk) — see `services/paid_record_lock.py`. A Paid
 * PAYMENT is locked on the server too, which is why payments get no pencil at all.
 */
import { APPROVAL_STATUS, ApprovalQueueRow } from "./approvalsTable.config";

/** Mirrors `services/role_profiles.PAYMENT_SETTLE_PROFILES` — keep the two lists in sync. */
export const QUEUE_EDIT_PROFILES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan Accountant Profile",
  "Nirmaan Accountant Lead Profile",
];

const EXPENSE_DOCTYPES: readonly string[] = ["Project Expenses", "Non Project Expenses"];

/** Statuses in which an expense row carries the pencil. Rejected is the only one left out. */
export const EXPENSE_EDITABLE_STATUSES: readonly string[] = [
  APPROVAL_STATUS.REQUESTED,
  APPROVAL_STATUS.CEO_PENDING,
  APPROVAL_STATUS.APPROVED,
  APPROVAL_STATUS.RECONCILIATION_PENDING,
  APPROVAL_STATUS.PAID,
];

/** Read-only in the expense edit dialogs once the expense is Paid. */
export const EXPENSE_FIELDS_LOCKED_WHEN_PAID = ["amount", "payment_date", "payment_ref"] as const;

type QueueRowLike = Pick<ApprovalQueueRow, "doctype" | "status">;

const statusOf = (row: QueueRowLike) => (row.status || "").trim();

/**
 * Does this role work the queue's settle end at all? `Administrator` arrives here as
 * "Nirmaan Admin Profile" (`useUserData` maps it).
 */
export const canWorkQueueRows = (role?: string | null): boolean =>
  !!role && QUEUE_EDIT_PROFILES.includes(role);

export const canEditQueueRow = (row: QueueRowLike, role?: string | null): boolean =>
  canWorkQueueRows(role) &&
  EXPENSE_DOCTYPES.includes(row.doctype) &&
  EXPENSE_EDITABLE_STATUSES.includes(statusOf(row));

export const canRevertQueueRow = (row: QueueRowLike, role?: string | null): boolean =>
  canWorkQueueRows(role) &&
  row.doctype === "Project Payments" &&
  statusOf(row) === APPROVAL_STATUS.RECONCILIATION_PENDING;

/** Is this expense Paid, so its money fields render read-only in the edit dialog? */
export const isPaidExpense = (status?: string | null): boolean =>
  (status || "").trim() === APPROVAL_STATUS.PAID;
