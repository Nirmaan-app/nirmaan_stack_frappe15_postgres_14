import { useFrappePostCall, useFrappeAuth } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

interface ApproveResponse {
  message: {
    name: string;
    status: string;
    approved_by: string | null;
    approved_on: string | null;
  };
}

interface RejectResponse {
  message: {
    name: string;
    status: string;
    rejection_reason: string;
  };
}

interface DeleteResponse {
  message: {
    name: string;
    deleted: boolean;
  };
}

interface ApproveItemsResponse {
  message: {
    name: string;
    items: { item_name: string; status: string }[];
  };
}

interface DispatchResponse {
  message: {
    name: string;
    status: string;
    dispatched_by: string;
    dispatched_on: string;
  };
}

/**
 * Lifecycle mutations for an Internal Transfer Memo (approve / reject / delete).
 *
 * Every call wraps the backend error path with `captureApiError` so Sentry
 * groups failures under the `internal_transfer_memo` feature and we can see
 * per-hook regressions without log-diving. We intentionally rethrow so the
 * caller can toast the user — this helper does NOT toast itself so it remains
 * reusable from dialogs that need to stay open on error.
 */
export function useITMMutations() {
  const { currentUser } = useFrappeAuth();

  const approveCall = useFrappePostCall<ApproveResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.approve_itm"
  );

  const rejectCall = useFrappePostCall<RejectResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.reject_itm"
  );

  const deleteCall = useFrappePostCall<DeleteResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.delete_itm"
  );

  const approveItemsCall = useFrappePostCall<ApproveItemsResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.approve_itm_items"
  );

  const dispatchCall = useFrappePostCall<DispatchResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.dispatch_itm"
  );

  const approve = async (name: string) => {
    try {
      return await approveCall.call({ name });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.approve",
        api: "lifecycle.approve_itm",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Memo",
        entity_id: name,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  const reject = async (name: string, reason: string) => {
    try {
      return await rejectCall.call({ name, reason });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.reject",
        api: "lifecycle.reject_itm",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Memo",
        entity_id: name,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  const approveItems = async (
    name: string,
    items: { item_name: string; action: string; reason?: string }[]
  ) => {
    try {
      return await approveItemsCall.call({ name, items: JSON.stringify(items) });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.approveItems",
        api: "lifecycle.approve_itm_items",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Memo",
        entity_id: name,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

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
    approve,
    reject,
    approveItems,
    dispatch,
    deleteItm,
    isApproving: approveCall.loading,
    isRejecting: rejectCall.loading,
    isApprovingItems: approveItemsCall.loading,
    isDispatching: dispatchCall.loading,
    isDeleting: deleteCall.loading,
  };
}
