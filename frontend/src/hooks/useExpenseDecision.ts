import { useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useCallback } from "react";

import {
  DECIDE_EXPENSES_API,
  splitMarkPaid,
  type ExpenseAction,
  type ExpenseDecisionResult,
  type ExpenseInvoice,
  type ExpensePayment,
} from "@/utils/expenses/expenseDecision";

interface DecideOptions {
  /** Required by `reject`. */
  reason?: string;
  /** Mark as Paid's payment details. */
  payment?: ExpensePayment;
  /** Mark as Paid's invoice details, saved in the same call. */
  invoice?: ExpenseInvoice;
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
        invoice: options.invoice ?? null,
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

/**
 * The save of both ledgers' pay dialog (`UpdatePaymentDetailsDialog`): Mark as Paid sends the payment
 * and the invoice details to the decision call as ONE write, so a refused Mark as Paid saves nothing;
 * a plain update of the payment details is an ordinary save.
 */
export function useSavePaymentDetails(doctype: "Project Expenses" | "Non Project Expenses") {
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { decideOne, loading: deciding } = useExpenseDecision();

  const save = useCallback(
    async (name: string, form: Record<string, unknown>, markAsPaid: boolean): Promise<void> => {
      if (markAsPaid) {
        await decideOne(name, "mark_paid", splitMarkPaid(form));
      } else {
        await updateDoc(doctype, name, form);
      }
    },
    [decideOne, updateDoc, doctype],
  );

  return { save, loading: updating || deciding };
}
