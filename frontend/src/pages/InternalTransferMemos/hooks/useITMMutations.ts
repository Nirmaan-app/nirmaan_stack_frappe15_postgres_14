import { useFrappePostCall, useFrappeAuth } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

// ---- ITR Mutations (approve/reject items) ----

interface ApproveITRResponse {
  message: {
    itr_name: string;
    itr_status: string;
    created_itms: string[];
    count: number;
  };
}

interface RejectITRResponse {
  message: {
    itr_name: string;
    itr_status: string;
    rejected_count: number;
  };
}

// ---- ITM Mutations (dispatch/delete) ----

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
 * Lifecycle mutations for ITR (approve/reject items) and ITM (dispatch/delete).
 */
export function useITMMutations() {
  const { currentUser } = useFrappeAuth();

  const approveITRCall = useFrappePostCall<ApproveITRResponse>(
    "nirmaan_stack.api.internal_transfers.approve_itr_items.approve_itr_items"
  );

  const rejectITRCall = useFrappePostCall<RejectITRResponse>(
    "nirmaan_stack.api.internal_transfers.approve_itr_items.reject_itr_items"
  );

  const dispatchCall = useFrappePostCall<DispatchResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.dispatch_itm"
  );

  const deleteCall = useFrappePostCall<DeleteResponse>(
    "nirmaan_stack.api.internal_transfers.lifecycle.delete_itm"
  );

  // --- ITR: Approve selected items → creates ITMs ---
  const approveITRItems = async (itrName: string, itemNames: string[]) => {
    try {
      return await approveITRCall.call({
        itr_name: itrName,
        item_names: JSON.stringify(itemNames),
      });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.approveITRItems",
        api: "approve_itr_items",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Request",
        entity_id: itrName,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  // --- ITR: Reject selected items ---
  const rejectITRItems = async (itrName: string, itemNames: string[], reason: string) => {
    try {
      return await rejectITRCall.call({
        itr_name: itrName,
        item_names: JSON.stringify(itemNames),
        reason,
      });
    } catch (e) {
      captureApiError({
        hook: "useITMMutations.rejectITRItems",
        api: "reject_itr_items",
        feature: "internal_transfer_memo",
        doctype: "Internal Transfer Request",
        entity_id: itrName,
        error: e,
        user: currentUser ?? undefined,
      });
      throw e;
    }
  };

  // --- ITM: Dispatch ---
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

  // --- ITM: Delete ---
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
    approveITRItems,
    rejectITRItems,
    dispatch,
    deleteItm,
    isApprovingITR: approveITRCall.loading,
    isRejectingITR: rejectITRCall.loading,
    isDispatching: dispatchCall.loading,
    isDeleting: deleteCall.loading,
  };
}
