import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback } from "react";

import {
  DECIDE_EXPENSES_API,
  type ExpenseAction,
  type ExpenseDecisionResult,
  type ExpensePayment,
} from "@/utils/expenses/expenseDecision";

interface DecideOptions {
  /** Required by `reject`. */
  reason?: string;
  /** Mark as Paid's payment details. */
  payment?: ExpensePayment;
}

/**
 * Every status change on a Project or Non-Project Expense, through the server's one decision call
 * (`expense_actions.decide_expenses`, #1497).
 *
 * `decide` takes many rows and returns the per-row result: partial failure is normal there, so the
 * caller reads `failed`. `decideOne` takes one row and throws with the server's reason when it is
 * refused, returning the status the expense now holds.
 */
export function useExpenseDecision() {
  const { call, loading } = useFrappePostCall<{ message?: { data?: ExpenseDecisionResult } }>(
    DECIDE_EXPENSES_API,
  );

  const decide = useCallback(
    async (names: string[], action: ExpenseAction, options: DecideOptions = {}): Promise<ExpenseDecisionResult> => {
      const response = await call({
        expense_ids: names,
        action,
        reason: options.reason ?? null,
        payment: options.payment ?? null,
      });
      const data = response?.message?.data;
      if (!data) throw new Error("The expense decision returned no result.");
      return data;
    },
    [call],
  );

  const decideOne = useCallback(
    async (name: string, action: ExpenseAction, options: DecideOptions = {}): Promise<string> => {
      const data = await decide([name], action, options);
      const refusal = data.failed.find((f) => f.name === name);
      if (refusal) throw new Error(refusal.reason);
      return data.statuses[name];
    },
    [decide],
  );

  return { decide, decideOne, loading };
}
