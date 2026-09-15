import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback } from "react";

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

const EXPENSE_DOCTYPES = new Set(["Project Expenses", "Non Project Expenses"]);

/** The minimum a row must carry to be routed. The queue row is a superset. */
export type BulkTargetRow = Pick<ApprovalQueueRow, "name" | "doctype">;

export const isExpenseRow = (row: BulkTargetRow): boolean =>
  EXPENSE_DOCTYPES.has(row.doctype);

interface ApiEnvelope {
  message?: {
    status?: number;
    message?: string;
    data?: BulkResult;
  };
}

export function useBulkApprovalActions(mode: BulkMode) {
  const { submit: submitPayments, loading: paymentsLoading } =
    useBulkPaymentActions(mode);

  const leadExpenses = useFrappePostCall(
    "nirmaan_stack.api.approvals.expense_actions.bulk_lead_approve_expenses"
  );
  const ceoExpenses = useFrappePostCall(
    "nirmaan_stack.api.approvals.expense_actions.bulk_ceo_approve_expenses"
  );
  const { call: callExpenses, loading: expensesLoading } =
    mode === "ceo" ? ceoExpenses : leadExpenses;

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
          const response: ApiEnvelope = await callExpenses({
            expense_ids: expenseIds,
            action,
            rejection_reason: rejectionReason ?? null,
          });
          const data = response?.message?.data;
          if (!data) throw new Error("Bulk expense action returned no data");
          succeeded.push(...data.succeeded);
          failed.push(...data.failed);
        } catch (err: any) {
          const reason = err?.message || "Bulk expense action failed";
          failed.push(...expenseIds.map((name) => ({ name, reason })));
        }
      }

      return { succeeded, failed, total: rows.length };
    },
    [submitPayments, callExpenses]
  );

  return { submit, loading: paymentsLoading || expensesLoading };
}
