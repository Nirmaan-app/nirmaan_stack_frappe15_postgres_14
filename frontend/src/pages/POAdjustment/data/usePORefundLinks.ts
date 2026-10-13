import { useFrappePostCall } from "frappe-react-sdk";
import { useCallback } from "react";
import useSWR from "swr";

const GET_PO_REFUND_LINKS =
  "nirmaan_stack.api.po_adjustments.refund_links.get_po_refund_links";

/**
 * What a PO's Received Vendor Refunds settle of its PO Adjustment balance (#1399).
 * `over_balance` is what they hold beyond the overpaid balance (0 below ₹1): the money
 * arrived before a revision explains it.
 */
export interface PORefundLinks {
  received: number;
  linked: number;
  over_balance: number;
}

export const poRefundLinksKey = (poId: string) =>
  ["po-adjustment", "refundLinks", poId] as const;

export function usePORefundLinks(poId: string | undefined) {
  const { call } = useFrappePostCall<{ message: PORefundLinks }>(GET_PO_REFUND_LINKS);

  const fetcher = useCallback(async () => {
    if (!poId) return null;
    const res = await call({ po_id: poId });
    return res?.message ?? null;
  }, [poId, call]);

  const { data, error, isLoading, mutate } = useSWR(
    poId ? poRefundLinksKey(poId) : null,
    fetcher
  );

  return { refundLinks: data ?? null, isLoading, error, mutate };
}
