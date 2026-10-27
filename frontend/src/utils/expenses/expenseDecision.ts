// The browser's half of the one call that changes an Expense's status (spec #1494 seam 2, #1497).
//
// The server decides: `nirmaan_stack/services/expense_decision.py` (who may, from which status, to
// which status). No screen writes an expense's `status` itself; it sends one of these actions to
// `decide_expenses` and shows the status the reply names. The hook is `hooks/useExpenseDecision`.

export const DECIDE_EXPENSES_API = "nirmaan_stack.api.approvals.expense_actions.decide_expenses";

/** The two expense ledgers: a queue row of either moves through `decide_expenses`, never a doc write. */
export const EXPENSE_DOCTYPES: readonly string[] = ["Project Expenses", "Non Project Expenses"];

export const isExpenseDoctype = (doctype: string | null | undefined): boolean =>
  !!doctype && EXPENSE_DOCTYPES.includes(doctype);

/**
 * The Project Payments bulk bars' one split (bulk Approve / Reject, bulk Mark as Paid): the ticked rows by
 * ledger, each in the order ticked. `expenses` -- both expense ledgers, a reimbursement's expense included
 * (ADR-0040) -- go in one `decide_expenses` call; `payments` to the payments engine. Keyed on `doctype` only:
 * `source_type` is a display label, so a reimbursement row is an expense because its ledger is.
 */
export const splitByLedger = <T extends { doctype?: string | null }>(rows: readonly T[]): { expenses: T[]; payments: T[] } => ({
  expenses: rows.filter((row) => isExpenseDoctype(row.doctype)),
  payments: rows.filter((row) => !isExpenseDoctype(row.doctype)),
});

/** Mirrors `expense_decision.ACTIONS`, pinned by `expenseDecision.test.ts`. */
export const EXPENSE_ACTIONS = ["l1_approve", "ceo_approve", "reject", "mark_done", "mark_paid"] as const;
export type ExpenseAction = (typeof EXPENSE_ACTIONS)[number];

/** Who may Mark as Done and Mark as Paid: mirrors `expense_decision.can_mark_paid`
 *  (`role_profiles.PAYMENT_SETTLE_PROFILES`), pinned by `expenseDecision.test.ts`. The server refuses
 *  anyone else; this only decides whether the button shows. */
export const MARK_PAID_PROFILES: readonly string[] = [
  "Nirmaan Admin Profile",
  "Nirmaan Accountant Profile",
  "Nirmaan Accountant Lead Profile",
];

/** Does this role profile get Mark as Paid? `Administrator` arrives as the Admin profile (`useUserData`). */
export const canMarkExpensePaid = (role: string | null | undefined): boolean =>
  !!role && MARK_PAID_PROFILES.includes(role);

/**
 * What the caller may edit by hand on an Expense, as the server answers it
 * (`expense_actions.get_expense_edit_access`, story 50; read by `hooks/useExpenseDecision`). Both
 * ledgers' `validate` refuse anything else, so the screens read this instead of restating the rule.
 */
export interface ExpenseEditAccess {
  /** The statuses in which the caller may edit an Expense at all. */
  editable_statuses: readonly string[];
  /** Per status, the only fields an edit may change. A listed status with no entry here allows
   *  every field but the status. */
  field_limits: Readonly<Record<string, readonly string[]>>;
  /** Per status, the fields no edit may change, whoever makes it (`expense_decision.LOCKED_FIELDS`:
   *  the pay-to account from Reconciliation Pending). */
  locked_fields: Readonly<Record<string, readonly string[]>>;
}

export const NO_EDIT_ACCESS: ExpenseEditAccess = { editable_statuses: [], field_limits: {}, locked_fields: {} };

/** May the caller change `field` on an Expense that is at `status`? */
export const mayEditExpenseField = (
  access: ExpenseEditAccess, status: string | null | undefined, field: string,
): boolean => {
  const at = (status || "").trim();
  if (!access.editable_statuses.includes(at)) return false;
  if (access.locked_fields[at]?.includes(field)) return false;
  const limit = access.field_limits[at];
  return !limit || limit.includes(field);
};

/** What Mark as Paid records with the status. A field left out keeps the value stored on the expense. */
export interface ExpensePayment {
  payment_date?: string | null;
  payment_ref?: string | null;
  payment_attachment?: string | null;
}

export interface ExpenseDecisionFailure {
  name: string;
  reason: string;
}

/** `decide_expenses`'s `data`: `statuses` is what each decided row now holds. */
export interface ExpenseDecisionResult {
  succeeded: string[];
  failed: ExpenseDecisionFailure[];
  statuses: Record<string, string>;
  total: number;
}

/** The invoice details Mark as Paid saves with the payment. A field sent as null is cleared; a field
 *  left out keeps the stored value. Mirrors `expense_decision.INVOICE_FIELDS`. */
export interface ExpenseInvoice {
  invoice_date?: string | null;
  invoice_ref?: string | null;
  invoice_attachment?: string | null;
}

const PAYMENT_FIELDS = ["payment_date", "payment_ref", "payment_attachment"] as const;
const INVOICE_FIELDS = ["invoice_date", "invoice_ref", "invoice_attachment"] as const;

/**
 * A pay dialog's form, split for Mark as Paid. Both halves go to the ONE decision call, so a refused
 * Mark as Paid saves nothing. A receipt the dialog did not replace is left out of `payment`, so the
 * one already stored on the expense stands. Any other field (a `status`, `payment_by`) is dropped:
 * the server writes those.
 */
export const splitMarkPaid = (
  form: Record<string, unknown>,
): { payment: ExpensePayment; invoice: ExpenseInvoice } => {
  const payment: ExpensePayment = {};
  const invoice: ExpenseInvoice = {};
  for (const [field, value] of Object.entries(form)) {
    if ((PAYMENT_FIELDS as readonly string[]).includes(field)) {
      if (typeof value === "string" && value) payment[field as keyof ExpensePayment] = value;
    } else if ((INVOICE_FIELDS as readonly string[]).includes(field)) {
      invoice[field as keyof ExpenseInvoice] = typeof value === "string" && value ? value : null;
    }
  }
  return { payment, invoice };
};
