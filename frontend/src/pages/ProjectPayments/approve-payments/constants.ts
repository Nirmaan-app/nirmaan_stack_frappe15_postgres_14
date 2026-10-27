// src/constants.ts
export const DOC_TYPES = {
  PROJECTS: "Projects" as const,
  VENDORS: "Vendors" as const,
  PROJECT_PAYMENTS: "Project Payments" as const,
  PROCUREMENT_ORDERS: "Procurement Orders" as const,
  SERVICE_REQUESTS: "Service Requests" as const,
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

// Hard ceiling on one bulk selection in the approvals queue. MUST mirror
// `nirmaan_stack/api/payments/bulk_actions.py::MAX_BATCH_SIZE` — and the expense engine,
// which imports that same constant. The endpoint throws the WHOLE batch back when it is
// exceeded, before any write, so a 140-row selection approves NOTHING; capping the
// selection is what keeps the user from ever reaching that throw.
//
// It is reachable at all because the page-size selector goes up to 10,000 rows: at 500
// rows per page the entire CEO-Pending queue sits on one page, and "select all on this
// page" is then the whole queue.
export const BULK_MAX_SELECTION = 100;
