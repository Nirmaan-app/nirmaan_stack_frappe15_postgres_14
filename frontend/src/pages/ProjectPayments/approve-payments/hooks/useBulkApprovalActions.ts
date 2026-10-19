import { useCallback } from "react";

import { useExpenseDecision } from "@/hooks/useExpenseDecision";
import { isExpenseDoctype, type ExpenseAction } from "@/utils/expenses/expenseDecision";

import { ApprovalQueueRow } from "../../config/approvalsTable.config";
import {
  BulkAction,
  BulkFailure,
  BulkMode,
  BulkResult,
  useBulkPaymentActions,
} from "./useBulkPaymentActions";

/**
 * One bulk action over the WHOLE unified queue — payments AND both expense ledgers.
 *
 * ⚠️ THERE ARE TWO ENGINES, AND THAT IS DELIBERATE. `bulk_actions` is built around a
 * PO/SR parent (row locks, `payment_terms` mirroring, one PO save per group, SR tax
 * withheld post-commit); an expense has no parent and none of that applies. So the
 * selection is SPLIT BY LEDGER here and each half goes to the engine that fits it.
 *
 * Before this existed, ticking an expense in the queue and pressing Approve sent its
 * name to the payments endpoint, which looked it up in `tabProject Payments`, found
 * nothing, and reported "Payment not found" — a failure row per expense, every time,
 * with the approval never attempted.
 *
 * Partial failure is the normal result — callers MUST inspect `failed`.
 */

/** The minimum a row must carry to be routed. The queue row is a superset. */
export type BulkTargetRow = Pick<ApprovalQueueRow, "name" | "doctype">;

export const isExpenseRow = (row: BulkTargetRow): boolean => isExpenseDoctype(row.doctype);

/** The queue's bulk click, as the expense decision call names it (#1497). */
const EXPENSE_ACTION: Record<BulkMode, Record<BulkAction, ExpenseAction>> = {
  lead: { approve: "l1_approve", reject: "reject" },
  ceo: { approve: "ceo_approve", reject: "reject" },
};

export function useBulkApprovalActions(mode: BulkMode) {
  const { submit: submitPayments, loading: paymentsLoading } =
    useBulkPaymentActions(mode);

  // Expenses go through the one decision call, the same one a single-row click uses, so a bulk
  // approval and a single one land an expense at the same status (#1497).
  const { decide: decideExpenses, loading: expensesLoading } = useExpenseDecision();

  const submit = useCallback(
    async (
      rows: BulkTargetRow[],
      action: BulkAction,
      rejectionReason?: string
    ): Promise<BulkResult> => {
      const expenseIds = rows.filter(isExpenseRow).map((r) => r.name);
      const paymentIds = rows.filter((r) => !isExpenseRow(r)).map((r) => r.name);

      const succeeded: string[] = [];
      const failed: BulkFailure[] = [];

      /**
       * The two halves run in SEQUENCE, not `Promise.all`. Each endpoint commits its
       * own transaction, and a rejection reason writes a comment per record after
       * that commit — interleaving two write batches against the same session buys
       * nothing on a ≤100-row batch and makes a partial failure harder to read.
       *
       * A throw from one half must not discard the other half's result, so each is
       * caught and reported as failures for its own ids. Anything else and a
       * permission error on the expense endpoint would silently hide the fact that
       * every payment in the same click was approved.
       */
      if (paymentIds.length) {
        try {
          const result = await submitPayments(paymentIds, action, rejectionReason);
          succeeded.push(...result.succeeded);
          failed.push(...result.failed);
        } catch (err: any) {
          const reason = err?.message || "Bulk payment action failed";
          failed.push(...paymentIds.map((name) => ({ name, reason })));
        }
      }

      if (expenseIds.length) {
        try {
          const data = await decideExpenses(expenseIds, EXPENSE_ACTION[mode][action], {
            reason: rejectionReason,
          });
          succeeded.push(...data.succeeded);
          failed.push(...data.failed);
        } catch (err: any) {
          const reason = err?.message || "Bulk expense action failed";
          failed.push(...expenseIds.map((name) => ({ name, reason })));
        }
      }

      return { succeeded, failed, total: rows.length };
    },
    [submitPayments, decideExpenses, mode]
  );

  return { submit, loading: paymentsLoading || expensesLoading };
}
