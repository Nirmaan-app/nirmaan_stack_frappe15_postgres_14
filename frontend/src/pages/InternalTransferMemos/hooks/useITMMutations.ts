import { useFrappePostCall, useFrappeAuth } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

interface DispatchResponse {
  message: {
    name: string;
    status: string;
    dispatched_by: string;
    dispatched_on: string;
  };
}

interface DeleteResponse {
  message: {
    name: string;
    deleted: boolean;
  };
}

/**
 * Lifecycle mutations for Internal Transfer Memos.
 *
 * After the ITR collapse, ITMs are born `Approved` directly from the picker
 * (`create_itms`); this hook only covers post-create transitions:
 *
 *   * `dispatch(name)` — Approved → Dispatched (Admin / Procurement only)
 *   * `deleteItm(name)` — destroys an Approved ITM and releases its reservation
 */
export function useITMMutations() {
  const { currentUser } = useFrappeAuth();

  const dispatchCall = useFrappePostCall<DispatchResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.dispatch_itm"
  );

  const deleteCall = useFrappePostCall<DeleteResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.delete_itm"
  );

  const dispatch = async (name: string) => {
    try {
      return await dispatchCall.call({ name });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.dispatch",
        api: "lifecycle.dispatch_itm",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Memo",
        entity_id: name,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  const deleteItm = async (name: string) => {
    try {
      return await deleteCall.call({ name });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.delete",
        api: "lifecycle.delete_itm",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Memo",
        entity_id: name,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  return {
    dispatch,
    deleteItm,
    isDispatching: dispatchCall.loading,
    isDeleting: deleteCall.loading,
  };
}
