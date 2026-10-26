/**
 * Who may edit or revert a row on the Payments queue tabs (owner, 2026-09-21).
 *
 * ONE rule for every tab — Payment Pending Approval, CEO Pending, Payment need to paid,
 * Reconciliation Pending, Payment Done, Payments Pending, Payment Raised By Me, and the
 * project / customer Financials tables — so the pencil can never appear on one tab and not
 * another for the same row.
 *
 *   PO / WO payment        no edit in any status; Reconciliation Pending → "Revert to Approved"
 *   Project / Non-Project  edit where the SERVER says the viewer may (`editableStatuses`, from
 *   expense                `useExpenseEditAccess`): Accounts until paid; a Paid one's details for
 *                          Admin and the Accountant Lead; never Rejected (story 50, owner
 *                          2026-10-20; both ledgers' `validate` refuse the rest). Which fields the
 *                          dialog lets them change is the same answer (`mayEditExpenseField`).
 *
 * A PO / WO payment gets no pencil at all, so it cannot be edited from the app in any status.
 */
import { unpayableReason } from "@/utils/payees/paidTo";

import { APPROVAL_STATUS, ApprovalQueueRow } from "./approvalsTable.config";

/** Mirrors `services/role_profiles.PAYMENT_SETTLE_PROFILES` — keep the two lists in sync. */
export const QUEUE_EDIT_PROFILES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan Accountant Profile",
  "Nirmaan Accountant Lead Profile",
];

const EXPENSE_DOCTYPES: readonly string[] = ["Project Expenses", "Non Project Expenses"];

type QueueRowLike = Pick<ApprovalQueueRow, "doctype" | "status">;

const statusOf = (row: QueueRowLike) => (row.status || "").trim();

/**
 * Does this role work the queue's settle end at all? `Administrator` arrives here as
 * "Nirmaan Admin Profile" (`useUserData` maps it).
 */
export const canWorkQueueRows = (role?: string | null): boolean =>
  !!role && QUEUE_EDIT_PROFILES.includes(role);

/** The expense pencil: an expense row in a status the server lets the viewer edit (`editableStatuses`). */
export const canEditQueueRow = (row: QueueRowLike, editableStatuses: readonly string[]): boolean =>
  EXPENSE_DOCTYPES.includes(row.doctype) && editableStatuses.includes(statusOf(row));

export const canRevertQueueRow = (row: QueueRowLike, role?: string | null): boolean =>
  canWorkQueueRows(role) &&
  row.doctype === "Project Payments" &&
  statusOf(row) === APPROVAL_STATUS.RECONCILIATION_PENDING;

/**
 * Hold / release an Approved PO / WO payment (owner, 2026-09-22) — the same three roles do both,
 * and any of them may release a hold another placed. Expenses cannot be held. The server's
 * `services/payment_hold.validate_hold` is the boundary; this only decides whether the icon renders.
 */
export const canHoldQueueRow = (row: QueueRowLike, role?: string | null): boolean =>
  canWorkQueueRows(role) &&
  row.doctype === "Project Payments" &&
  statusOf(row) === APPROVAL_STATUS.APPROVED;

/**
 * Upload / replace the invoice on a Paid expense (either ledger), from "Payment Done / Reconciliation
 * Done" — the same three roles that work the queue. Project Expenses were added 2026-10-07 (owner);
 * a PO / WO payment never: its invoices are Vendor Invoices. The upload saves the expense, so it also
 * needs the server's leave to edit a Paid row (`editableStatuses`): Admin and the Accountant Lead
 * have it (story 50, owner 2026-10-20), an Accountant does not.
 */
export const canUploadInvoiceRow = (
  row: QueueRowLike, role: string | null | undefined, editableStatuses: readonly string[],
): boolean =>
  canWorkQueueRows(role) &&
  isPaidExpense(row.status) &&
  canEditQueueRow(row, editableStatuses);

/** Is this payment held? It stays Approved but cannot be marked as paid or ticked. */
export const isHeldQueueRow = (row: Pick<ApprovalQueueRow, "on_hold">): boolean =>
  Number(row.on_hold) === 1;

/**
 * Can this row on "Payment need to paid" be ticked and marked paid? Not when it is held, nor when it is
 * Ineligible: there is nowhere to send its money (`paidTo.rowEligibility`, #1464). A row kept out of the
 * bank file (a cheque, a card / cash expense) can: only the export leaves it out.
 */
export const canPayQueueRow = (row: Pick<ApprovalQueueRow, "on_hold" | "paid_to" | "expense_type">): boolean =>
  unpayableReason(row.paid_to, row.expense_type, isHeldQueueRow(row)) === null;

/** Is this expense Paid, so its money fields render read-only in the edit dialog? */
export const isPaidExpense = (status?: string | null): boolean =>
  (status || "").trim() === APPROVAL_STATUS.PAID;
