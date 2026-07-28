// src/utils/expenseApproval.ts
//
// The ONE frontend home for the expense auto-approval rule (ADR-0010 F1/F4:
// a domain rule has one home, pure and unit-testable without React).
//
// Mirrors the backend predicate, which lives identically in BOTH doctype
// controllers -- `project_expenses.py` and `non_project_expenses.py`:
//
//     AUTO_APPROVE_LIMIT = 5000
//     if 0 < flt(self.amount) < AUTO_APPROVE_LIMIT:
//         self.status = "Approved"
//
// The backend is the authority; this module exists only so the create dialogs
// can TELL the user which path their expense is about to take. It must never
// drift from the rule above -- `expenseApproval.test.ts` pins the constant
// against the Python source.
//
// Note the two edges the plain phrase "under 5000" gets wrong, and which the
// button label must honour or it lies to the user:
//   - EXACTLY 5000 is NOT auto-approved (the backend comparison is strict `<`).
//   - A REFUND (negative amount, which Non-Project Expenses explicitly supports)
//     is NOT auto-approved either -- it takes the full Requested -> Approved
//     -> Paid path, despite being "less than 5000".

import { parseNumber } from "./parseNumber";

/**
 * Positive expense amounts strictly below this are created directly as
 * `Approved`, skipping `Requested`.
 *
 * Keep in sync with `AUTO_APPROVE_LIMIT` in the two expense doctype
 * controllers (see the module header).
 */
export const EXPENSE_AUTO_APPROVE_LIMIT = 5000;

/** Button copy for the two paths a newly created expense can take. */
export const EXPENSE_SUBMIT_LABELS = {
  /** Auto-approved on save -- no approver involved. */
  autoApproved: "Raise Expense",
  /** Enters the workflow at `Requested` and waits for an approver. */
  needsApproval: "Send for Approval",
} as const;

/**
 * Whether an amount will be auto-approved at create time.
 *
 * Non-numeric / blank input parses to 0 via `parseNumber`, which fails the
 * `> 0` test and therefore reports "needs approval" -- the safe default while
 * the user is still typing.
 */
export const isAutoApprovedExpenseAmount = (
  amount: string | number | undefined | null
): boolean => {
  const value = parseNumber(amount);
  return value > 0 && value < EXPENSE_AUTO_APPROVE_LIMIT;
};

/**
 * The create-dialog submit-button label for the given amount.
 * Used by `NewProjectExpenseDialog` and `NewNonProjectExpense`.
 */
export const getExpenseSubmitLabel = (
  amount: string | number | undefined | null
): string =>
  isAutoApprovedExpenseAmount(amount)
    ? EXPENSE_SUBMIT_LABELS.autoApproved
    : EXPENSE_SUBMIT_LABELS.needsApproval;
