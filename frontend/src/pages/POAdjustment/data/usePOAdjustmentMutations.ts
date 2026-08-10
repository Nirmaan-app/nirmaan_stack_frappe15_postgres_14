import { useFrappePostCall } from "frappe-react-sdk";
import { PO_ADJUSTMENT_APIS, WRITE_OFF_REASON_MAX_LEN } from "./poAdjustment.constants";

/**
 * D5: may the current user write off an adjustment balance? MIRRORS the server's
 * `pricing._is_nirmaan_admin` (Administrator OR role_profile "Nirmaan Admin Profile"), and
 * the sibling predicates `SheetPricingPage.canAdminOverride` / `isRateMasterAdmin`. False
 * while the role is still "Loading" so the control never flashes in for a non-admin.
 * CONVENIENCE ONLY — `write_off_adjustment` re-gates server-side and is authoritative.
 */
export function canWriteOffAdjustment(role: string, userId: string): boolean {
  if (role === "Loading") return false;
  return userId === "Administrator" || role === "Nirmaan Admin Profile";
}

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
  return_type: "Against-po" | "Vendor-has-refund" | "Ad-hoc";
  amount: number;
  target_pos?: { po_number: string; amount: number }[];
  utr?: string;
  refund_attachment?: string;
  refund_date?: string;
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
