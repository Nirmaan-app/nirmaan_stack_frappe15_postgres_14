// src/utils/settlement.ts
//
// Frontend MIRROR of `nirmaan_stack/services/settlement.py`.
// THE PYTHON FILE IS THE AUTHORITY. `settlement.test.ts` reads it and fails on drift.
//
// WHAT THIS IS FOR
// `status === "Paid"` was the definition of settled spend in ~22 frontend sites --
// useProjectRootApi, the outflow reports, PaymentSummaryCards, the CEO-hold cashflow-gap
// mirror in ApprovePayments, the vendor ledger, both expense column files, and more.
//
// The owner ruled on 2026-09-15 that `Paid` now means RECONCILED, with a new status before it:
//
//     Requested -> CEO Pending -> Approved -> Reconciliation Pending -> Paid
//
// Money leaves the bank at `Approved -> Reconciliation Pending` and sits there until the
// bank statement confirms it. **Every one of those sites must count BOTH, or the UI
// under-reports money already spent -- silently, with nothing on screen looking wrong.**
//
// ⚠️ From the day the call sites bind this, a literal `"Paid"` in a money filter is a defect.

/** Money has LEFT the bank; the statement has not confirmed it yet. */
export const STATUS_RECONCILIATION_PENDING = "Reconciliation Pending";
/** Terminal. Money left the bank AND the statement confirmed it. */
export const STATUS_PAID = "Paid";

/** ⭐ THE CONSTANT. Money that has left the bank. Bind this; never write a literal. */
export const SETTLED_STATUSES = [
  STATUS_RECONCILIATION_PENDING,
  STATUS_PAID,
] as const;

/**
 * Sanctioned, but the money has NOT moved.
 * ⚠️ Deliberately DISJOINT from SETTLED_STATUSES -- a status in both would be counted
 * twice, once as paid and once as outstanding.
 */
export const PENDING_STATUSES = [
  "Requested",
  "CEO Pending",
  "Approved",
  "Rejected",
] as const;

/** The lifecycle in order. */
export const STATUS_SEQUENCE = [
  "Requested",
  "CEO Pending",
  "Approved",
  STATUS_RECONCILIATION_PENDING,
  STATUS_PAID,
] as const;

/** The owner's vocabulary. One label per status, composed nowhere else. */
export const STATUS_LABELS: Record<string, string> = {
  Requested: "Payment Pending Approval",
  "CEO Pending": "Payment Pending CEO Approval",
  Approved: "Payment need to paid",
  [STATUS_RECONCILIATION_PENDING]: "Payment Done / Reconciliation Pending",
  [STATUS_PAID]: "Payment Done / Reconciliation Done",
  Rejected: "Rejected",
};

const clean = (status: string | null | undefined): string => (status ?? "").trim();

/** Has the money left the bank? TRUE for both settled statuses. */
export const isSettled = (status: string | null | undefined): boolean =>
  (SETTLED_STATUSES as readonly string[]).includes(clean(status));

/** Sanctioned or in flight, but the money has NOT moved. */
export const isPending = (status: string | null | undefined): boolean =>
  (PENDING_STATUSES as readonly string[]).includes(clean(status));

/**
 * A Frappe list filter for settled rows.
 * Use in place of `["status", "=", "Paid"]` at every money site.
 */
export const settledFilter = (
  fieldname = "status"
): [string, string, string[]] => [fieldname, "in", [...SETTLED_STATUSES]];

/** The owner's display label; unknown values pass through rather than blanking. */
export const statusLabel = (status: string | null | undefined): string => {
  const c = clean(status);
  return STATUS_LABELS[c] ?? c;
};
