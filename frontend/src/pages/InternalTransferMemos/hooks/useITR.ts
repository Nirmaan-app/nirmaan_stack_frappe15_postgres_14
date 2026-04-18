import { useFrappeGetDoc } from "frappe-react-sdk";
import type { InternalTransferRequest } from "@/types/NirmaanStack/InternalTransferMemo";

/**
 * Fetches a single Internal Transfer Request with its child items.
 */
export function useITR(id: string | undefined) {
  return useFrappeGetDoc<InternalTransferRequest>(
    "Internal Transfer Request",
    id,
    id ? undefined : null
  );
}
