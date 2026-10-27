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
  /**
   * Approved payments whose TDS could not be withheld: approved, still at their GROSS amount, and
   * waiting for Retry TDS (#1536). Empty for a reject, and for a batch with no Work Order payment.
   */
  tdsFailed: string[];
}

interface ApiResult {
  succeeded: string[];
  failed: BulkFailure[];
  total: number;
  tds_failed?: string[];
}

interface ApiEnvelope {
  message?: {
    status?: number;
    message?: string;
    data?: ApiResult;
  };
}

/** What Retry TDS answers (`bulk_actions.retry_bulk_deductions`). */
export interface TdsRetryResult {
  tds_recorded: number;
  /** Still failing: retry again, or ask for the Error Log. */
  tds_failed: string[];
  /** No longer at Approved, so no tax can be withheld here any more. */
  not_approved: string[];
}

/** Retry TDS on the payments a bulk approve named in `tdsFailed`. Admin only, on the server too. */
export function useRetryBulkTds() {
  const { call, loading } = useFrappePostCall<{ message: TdsRetryResult }>(
    "nirmaan_stack.api.payments.bulk_actions.retry_bulk_deductions"
  );
  const retry = useCallback(
    async (paymentIds: string[]): Promise<TdsRetryResult> => {
      const response = await call({ payment_ids: paymentIds });
      if (!response?.message) throw new Error("Retry TDS returned no data");
      return response.message;
    },
    [call]
  );
  return { retry, loading };
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
      return {
        succeeded: data.succeeded,
        failed: data.failed,
        total: data.total,
        tdsFailed: data.tds_failed ?? [],
      };
    },
    [call]
  );

  return { submit, loading };
}
