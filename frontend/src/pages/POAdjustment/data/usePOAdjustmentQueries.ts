import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback } from "react";
import useSWR from "swr";
import { poAdjustmentKeys, PO_ADJUSTMENT_APIS } from "./poAdjustment.constants";

interface AdjustmentItem {
  entry_type: string;
  revision_id?: string;
  amount: number;
  description?: string;
  timestamp?: string;
  project_payment?: string;
  target_po?: string;
  expense_type?: string;
  refund_date?: string;
  refund_attachment?: string;
  owner?: string;
  created_by?: string;
}

/**
 * Who last hand-edited an adjustment's balance or its audit rows.
 * `null` means the Version log has no record — the edit predates `track_changes`
 * being enabled on PO Adjustments (2026-08-11). It does NOT mean nobody edited it.
 */
export interface AdjustmentManualEdit {
  by: string;
  at: string;
}

export interface POAdjustmentDoc {
  name: string;
  po_id: string;
  project: string;
  vendor: string;
  status: "Pending" | "Done";
  remaining_impact: number;
  adjustment_items: AdjustmentItem[];
  /**
   * Ledger-integrity trio, surfaced additively by `get_po_adjustment`.
   *
   * `remaining_impact` is deliberately left hand-editable for emergencies (owner
   * ruling 2026-08-11), so a mismatch with the audit rows is a legitimate state,
   * not corruption — but it must never be SILENT. Two POs sat payment-locked for
   * weeks on numbers nobody could account for, because a Desk edit left no trace.
   *
   * Optional so a client running against an older backend still type-checks; treat
   * `undefined` as "unknown", never as "in sync".
   */
  computed_from_children?: number;
  ledger_in_sync?: boolean;
  manual_edit?: AdjustmentManualEdit | null;
}

interface CandidatePO {
  name: string;
  vendor: string;
  total_amount: number;
  amount_paid: number;
  vendor_name: string;
  creation: string;
  project: string;
  project_name: string;
  status: string;
  created_terms_amount: number;
}

/**
 * Fetches the PO Adjustment doc for a given PO.
 * Returns null if no adjustment exists.
 */
export function usePOAdjustment(poId: string | undefined) {
  const { call } = useFrappePostCall<{ message: POAdjustmentDoc | null }>(
    PO_ADJUSTMENT_APIS.getAdjustment
  );

  const fetcher = useCallback(async () => {
    if (!poId) return null;
    const res = await call({ po_id: poId });
    return res?.message ?? null;
  }, [poId, call]);

  const { data, error, isLoading, mutate } = useSWR(
    poId ? poAdjustmentKeys.adjustmentDoc(poId) : null,
    fetcher
  );

  return {
    adjustment: data ?? null,
    isLoading,
    error,
    mutate,
  };
}

export interface VendorCreditSource {
  po_id: string;
  project: string;
  project_name: string | null;
  available: number;
  status: string | null;
}

export interface VendorAdjustmentCredit {
  total_available: number;
  source_count: number;
  sources: VendorCreditSource[];
}

/**
 * Fetches the vendor-wide pool of overpaid adjustment credit (across all the
 * vendor's POs), excluding the current PO. Powers the top-of-PO summary panel.
 */
export function useVendorAdjustmentCredit(
  vendor: string | undefined,
  excludePo: string | undefined,
  enabled = true
) {
  const { call } = useFrappePostCall<{ message: VendorAdjustmentCredit }>(
    PO_ADJUSTMENT_APIS.getVendorCredit
  );

  const fetcher = useCallback(async () => {
    if (!vendor) return null;
    const res = await call({ vendor, exclude_po: excludePo });
    return res?.message ?? null;
  }, [vendor, excludePo, call]);

  const { data, error, isLoading, mutate } = useSWR(
    enabled && vendor
      ? poAdjustmentKeys.vendorCredit(vendor, excludePo)
      : null,
    fetcher
  );

  return {
    vendorCredit: data ?? null,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Fetches candidate POs for "Against-PO" adjustment method.
 */
export function useAdjustmentCandidatePOs(
  vendor: string | undefined,
  currentPO: string | undefined,
  enabled = false
) {
  const { call } = useFrappePostCall<{ message: CandidatePO[] }>(
    PO_ADJUSTMENT_APIS.getCandidatePOs
  );

  const fetcher = useCallback(async () => {
    if (!vendor || !currentPO) return [];
    const res = await call({ vendor, current_po: currentPO });
    return res?.message ?? [];
  }, [vendor, currentPO, call]);

  const { data, error, isLoading, mutate } = useSWR(
    enabled && vendor ? poAdjustmentKeys.candidatePOs(vendor) : null,
    fetcher
  );

  return {
    candidatePOs: data ?? [],
    isLoading,
    error,
    mutate,
  };
}
