import { useFrappePostCall, useFrappeAuth } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";
import type { CreateItmsPayloadSelection } from "../types";

interface CreateResponse {
  message: {
    requests: string[];
    count: number;
  };
}

interface CreatePayload {
  target_project?: string | null;
  target_type?: "Project" | "Warehouse";
  selections: CreateItmsPayloadSelection[];
}

/**
 * Wraps `create_transfer_request` — creates ITR only (no ITMs).
 * ITMs are created later when admin approves items.
 */
export function useCreateITMs() {
  const { call, loading, error } = useFrappePostCall<CreateResponse>(
    "nirmaan_stack.api.internal_transfers.create_transfer_request.create_transfer_request"
  );
  const { currentUser } = useFrappeAuth();

  const create = async (payload: CreatePayload) => {
    try {
      const result = await call(payload as unknown as Record<string, unknown>);
      return result;
    } catch (e) {
      captureApiError({
        hook: "useCreateITMs",
        api: "create_transfer_request",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Request",
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  return { create, isLoading: loading, error };
}
