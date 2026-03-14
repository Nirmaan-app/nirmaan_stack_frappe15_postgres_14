import { useFrappePostCall } from "frappe-react-sdk";
import { PO_ADJUSTMENT_APIS } from "./poAdjustment.constants";

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
