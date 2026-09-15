// src/constants.ts
export const DOC_TYPES = {
  PROJECTS: "Projects" as const,
  VENDORS: "Vendors" as const,
  PROJECT_PAYMENTS: "Project Payments" as const,
  PROCUREMENT_ORDERS: "Procurement Orders" as const,
  SERVICE_REQUESTS: "Service Requests" as const,
};

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

// There is deliberately NO "edit" action here any more.
//
// It used to exist and was UNREACHABLE — no button ever opened it — and what it did was shrink a
// payment's amount in place, silently discarding the difference. That is the exact outcome the
// partial-approval split was built to prevent: the vendor is still owed the balance, but no
// document would say so. Amount editing now lives on the APPROVE action (see
// `PaymentActionDialog`'s `allowPartial`), which splits rather than truncates. Do not reintroduce
// a second way to change an amount.
export const DIALOG_ACTION_TYPES = {
  APPROVE: "approve" as const,
  REJECT: "reject" as const,
};

// You can define types based on these constants
export type DialogActionType = typeof DIALOG_ACTION_TYPES[keyof typeof DIALOG_ACTION_TYPES];