import { useFrappePostCall, useFrappeAuth } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";
import type { CreateItmsPayloadSelection } from "../types";

interface CreateResponse {
  message: {
    itms: string[];
    count: number;
  };
}

interface CreatePayload {
  target_project?: string | null;
  target_type?: "Project" | "Warehouse";
  selections: CreateItmsPayloadSelection[];
}

/**
 * Wraps `create_itms` — creates Internal Transfer Memo(s) directly in
 * "Approved" status, one per source-project group (plus one extra for
 * warehouse-sourced selections, if any).
 */
export function useCreateITMs() {
  const { call, loading, error } = useFrappePostCall<CreateResponse>(
    "nirmaan_stack.api.internal_transfers.create_itms.create_itms"
  );
  const { currentUser } = useFrappeAuth();

  const create = async (payload: CreatePayload) => {
    try {
      const result = await call(payload as unknown as Record<string, unknown>);
      return result;
    } catch (e) {
      captureApiError({
        hook: "useCreateITMs",
        api: "create_itms",
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
