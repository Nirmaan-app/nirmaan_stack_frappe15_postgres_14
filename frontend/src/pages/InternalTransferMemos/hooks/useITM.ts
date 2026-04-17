import { useFrappeGetCall } from "frappe-react-sdk";
import type { InternalTransferMemo } from "@/types/NirmaanStack/InternalTransferMemo";

/**
 * Payload returned by `nirmaan_stack.api.internal_transfers.get_itm.get_itm`.
 *
 * The backend denormalises project labels and user full names so the detail
 * page can render without a second round-trip. `itm` is the complete doc
 * (including child `items` rows).
 */
export interface ITMDetailPayload {
  itm: InternalTransferMemo;
  source_project_name: string | null;
  target_project_name: string | null;
  requested_by_full_name: string | null;
  approved_by_full_name: string | null;
}

interface ITMDetailResponse {
  message: ITMDetailPayload;
}

/**
 * Fetches the full ITM detail payload.
 *
 * NOTE: the API is a custom RPC (not a standard doctype read) — we intentionally
 * use `useFrappeGetCall` rather than `useFrappeGetDoc` so we get the enriched
 * joined labels in a single call.
 *
 * When `id` is undefined the hook short-circuits by passing `undefined` params;
 * frappe-react-sdk treats that as "no fetch" via SWR.
 */
export function useITM(id: string | undefined) {
  return useFrappeGetCall<ITMDetailResponse>(
    "nirmaan_stack.api.internal_transfers.get_itm.get_itm",
    id ? { name: id } : undefined
  );
}
