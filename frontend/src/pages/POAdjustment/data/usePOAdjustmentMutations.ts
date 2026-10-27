import { useFrappePostCall } from "frappe-react-sdk";
import { PO_ADJUSTMENT_APIS, WRITE_OFF_REASON_MAX_LEN } from "./poAdjustment.constants";

/**
 * D5: normalise the MANDATORY reason. Trim, cap to the server's length, and report whether
 * what remains is usable — a write-off with no reason is the Desk edit again, wearing a
 * button, so the caller disables submit on `!isValid`. Pure.
 */
export function normalizeWriteOffReason(raw: string): { value: string; isValid: boolean } {
  const value = raw.slice(0, WRITE_OFF_REASON_MAX_LEN).trim();
  return { value, isValid: value.length > 0 };
}

interface AdjustmentEntry {
  return_type: "Against-po" | "Ad-hoc";
  amount: number;
  target_pos?: { po_number: string; amount: number }[];
  "ad-hoc_description"?: string;
  "ad-hoc_type"?: string;
  comment?: string;
}

interface ExecuteAdjustmentResult {
  status: string;
  adjustment: string;
  remaining_impact: number;
}

/**
 * Hook to execute a PO Adjustment.
 */
export function useExecuteAdjustment() {
  const { call, loading, error } = useFrappePostCall<{
    message: ExecuteAdjustmentResult;
  }>(PO_ADJUSTMENT_APIS.executeAdjustment);

  const execute = async (poId: string, adjustments: AdjustmentEntry[]) => {
    const res = await call({
      po_id: poId,
      adjustments_json: JSON.stringify(adjustments),
    });
    return res?.message;
  };

  return { execute, loading, error };
}

export interface VendorCreditAllocation {
  source_po: string;
  amount: number;
}

interface ApplyVendorCreditResult {
  status: string;
  dest_po: string;
  applied: Record<string, number>;
  total_applied: number;
}

/**
 * Hook to pull overpaid vendor credit INTO a destination PO.
 */
export function useApplyVendorCredit() {
  const { call, loading, error } = useFrappePostCall<{
    message: ApplyVendorCreditResult;
  }>(PO_ADJUSTMENT_APIS.applyVendorCredit);

  const apply = async (
    destPo: string,
    allocations: VendorCreditAllocation[]
  ) => {
    const res = await call({
      dest_po: destPo,
      allocations_json: JSON.stringify(allocations),
    });
    return res?.message;
  };

  return { apply, loading, error };
}

export interface WaitingRefundInput {
  amount: number;
  payment_date?: string;
  utr?: string;
  refund_attachment?: string;
}

interface RecordWaitingRefundResult {
  refund: string;
  status: string;
  held_credit: number;
  usable_credit: number;
}

/**
 * Record a waiting Vendor Refund on a PO (#1400, ADR-0032): the vendor says it sent the money, the
 * bank line is not matched yet. It counts for nothing until accounts match it, and holds its amount of
 * the PO's overpaid credit. The server re-checks the role and the unheld balance.
 */
export function useRecordWaitingRefund() {
  const { call, loading, error } = useFrappePostCall<{
    message: RecordWaitingRefundResult;
  }>(PO_ADJUSTMENT_APIS.recordWaitingRefund);

  const record = async (poId: string, refund: WaitingRefundInput) => {
    const res = await call({ po_id: poId, ...refund });
    return res?.message;
  };

  return { record, loading, error };
}

interface WriteOffResult {
  status: string;
  adjustment: string;
  written_off: number;
  remaining_impact: number;
}

/**
 * D5: write off an adjustment balance that does not correspond to money. Admin only.
 *
 * Unlike every other resolution method, this creates NO `Project Payments` row and never
 * touches `amount_paid` — that is the whole point. `amount` is a MAGNITUDE; the server
 * derives the sign from the current balance so a write-off can only move it toward zero.
 */
export function useWriteOffAdjustment() {
  const { call, loading, error } = useFrappePostCall<{ message: WriteOffResult }>(
    PO_ADJUSTMENT_APIS.writeOff
  );

  const writeOff = async (poId: string, amount: number, reason: string) => {
    const res = await call({ po_id: poId, amount, reason });
    return res?.message;
  };

  return { writeOff, loading, error };
}
