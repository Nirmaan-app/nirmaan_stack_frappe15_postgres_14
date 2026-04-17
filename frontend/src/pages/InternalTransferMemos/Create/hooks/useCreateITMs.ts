import { useFrappePostCall, useFrappeAuth } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";
import type { CreateItmsPayloadSelection } from "../types";

interface CreateItmsResponse {
  message: {
    request: string;
    created: string[];
    count: number;
  };
}

interface CreatePayload {
  target_project: string;
  selections: CreateItmsPayloadSelection[];
}

/**
 * Wraps `create_itms_from_inventory`. On error, routes to Sentry with a
 * feature-scoped tag so these show up under "internal_transfer_memo" issues.
 */
export function useCreateITMs() {
  const { call, loading, error } = useFrappePostCall<CreateItmsResponse>(
    "nirmaan_stack.api.internal_transfers.create_itms_from_inventory.create_itms_from_inventory"
  );
  const { currentUser } = useFrappeAuth();

  const create = async (payload: CreatePayload) => {
    try {
      const result = await call(payload as unknown as Record<string, unknown>);
      return result;
    } catch (e) {
      captureApiError({
        hook: "useCreateITMs",
        api: "create_itms_from_inventory",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Memo",
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  return { create, isLoading: loading, error };
}
