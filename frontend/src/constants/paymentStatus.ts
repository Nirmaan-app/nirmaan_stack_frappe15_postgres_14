/** A Project Payment's statuses. Shared by pages and the pure `utils/` helpers, so it lives outside any page. */
export const PAYMENT_STATUS = {
  REQUESTED: "Requested" as const,
  CEO_PENDING: "CEO Pending" as const,
  APPROVED: "Approved" as const,
  // Money has LEFT the bank but the bank statement has not confirmed it yet.
  // `Paid` now means reconciled; this is the state between the two.
  RECONCILIATION_PENDING: "Reconciliation Pending" as const,
  REJECTED: "Rejected" as const,
  SCHEDULED: "Scheduled" as const,
  CREATED: "Created" as const,
  PAID: "Paid" as const,
};
