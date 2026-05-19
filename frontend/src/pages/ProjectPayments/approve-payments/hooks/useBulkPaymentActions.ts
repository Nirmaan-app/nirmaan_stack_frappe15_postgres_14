import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback } from "react";

export type BulkAction = "approve" | "reject";
export type BulkMode = "lead" | "ceo";

export interface BulkFailure {
  name: string;
  reason: string;
}

export interface BulkResult {
  succeeded: string[];
  failed: BulkFailure[];
  total: number;
}

interface ApiEnvelope {
  message?: {
    status?: number;
    message?: string;
    data?: BulkResult;
  };
}

/**
 * Calls the bulk action endpoint for the given mode.
 * Partial failure is the normal result — callers MUST inspect `failed`.
 */
export function useBulkPaymentActions(mode: BulkMode) {
  const lead = useFrappePostCall(
    "nirmaan_stack.api.payments.bulk_actions.bulk_lead_approve_payments"
  );
  const ceo = useFrappePostCall(
    "nirmaan_stack.api.payments.bulk_actions.bulk_ceo_approve_payments"
  );

  const { call, loading } = mode === "ceo" ? ceo : lead;

  const submit = useCallback(
    async (
      paymentIds: string[],
      action: BulkAction,
      rejectionReason?: string
    ): Promise<BulkResult> => {
      const response: ApiEnvelope = await call({
        payment_ids: paymentIds,
        action,
        rejection_reason: rejectionReason ?? null,
      });

      const data = response?.message?.data;
      if (!data) {
        throw new Error("Bulk action returned no data");
      }
      return data;
    },
    [call]
  );

  return { submit, loading };
}
