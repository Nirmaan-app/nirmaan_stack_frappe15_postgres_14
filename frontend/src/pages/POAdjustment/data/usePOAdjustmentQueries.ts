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

export interface POAdjustmentDoc {
  name: string;
  po_id: string;
  project: string;
  vendor: string;
  status: "Pending" | "Done";
  remaining_impact: number;
  adjustment_items: AdjustmentItem[];
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
