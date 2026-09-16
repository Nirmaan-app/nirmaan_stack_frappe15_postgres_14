import { useCallback } from "react";
import { useSWRConfig } from "frappe-react-sdk";

import { APPROVAL_COUNTS_SWR_KEY } from "../config/approvalsTable.config";

/**
 * Refresh the payments page's tab badges.
 *
 * The badges are one SWR fetch owned by `RenderProjectPaymentsComponent`, while every
 * status change happens inside a lazy child tab. Call this after any action that moves
 * a row between tabs (approve, reject, mark paid, reconcile, edit), next to the table's
 * own `refetch()`.
 *
 * ⚠️ `useSWRConfig` MUST come from `frappe-react-sdk`, not `swr`: the SDK bundles its
 * own SWR, so a `mutate` from the app's `swr` package reads a different cache and
 * silently refreshes nothing.
 */
export const useRefreshApprovalCounts = () => {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    mutate(APPROVAL_COUNTS_SWR_KEY);
  }, [mutate]);
};
