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

/** Mirrors `expense_decision.ACTIONS`. */
export type ExpenseAction = "l1_approve" | "ceo_approve" | "reject" | "mark_done" | "mark_paid";

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

const PAYMENT_FIELDS = ["payment_date", "payment_ref", "payment_attachment"] as const;
// Written only by the decision call.
const DECIDED_FIELDS = new Set<string>(["status", "payment_by"]);

/**
 * A pay dialog's form, split for Mark as Paid: the payment goes to the decision call with the
 * status; the rest (the invoice details) is an ordinary save. A receipt the dialog did not replace
 * is left out, so the one already stored on the expense stands.
 */
export const splitMarkPaid = (
  form: Record<string, unknown>,
): { payment: ExpensePayment; details: Record<string, unknown> } => {
  const payment: ExpensePayment = {};
  const details: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(form)) {
    if ((PAYMENT_FIELDS as readonly string[]).includes(field)) {
      if (value) payment[field as keyof ExpensePayment] = value as string;
    } else if (!DECIDED_FIELDS.has(field)) {
      details[field] = value;
    }
  }
  return { payment, details };
};
