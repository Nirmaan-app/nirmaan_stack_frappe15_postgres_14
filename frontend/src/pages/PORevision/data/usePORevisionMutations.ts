import { useFrappePostCall, useFrappeUpdateDoc, useFrappeAuth } from "frappe-react-sdk";
import { useSWRConfig } from "swr";
import { captureApiError } from "@/utils/sentry/captureApiError";
import {
  poRevisionKeys,
  PO_REVISION_DOCTYPE,
  PO_REVISION_APIS,
} from "./poRevision.constants";

// ─── Create Revision (Submit draft) ──────────────────────────

export const useCreateRevision = () => {
  const { call, loading } = useFrappePostCall(PO_REVISION_APIS.makeRevision);
  const { mutate } = useSWRConfig();
  const { currentUser } = useFrappeAuth();

  const createRevision = async (payload: {
    po_id: string;
    justification: string;
    revision_items: string;
    total_amount_difference: number;
    payment_return_details: string;
  }) => {
    try {
      const result = await call(payload);

      try {
        // Invalidate lock check so Warning banner refreshes
        // Invalidate revision history so the history section on PO details refetches
        await Promise.all([
          mutate(poRevisionKeys.lockCheck(payload.po_id)),
          mutate(poRevisionKeys.revisionHistory(payload.po_id)),
        ]);
      } catch (invalidateError) {
        captureApiError({
          hook: "useCreateRevision",
          api: "SWR Invalidation",
          feature: "po-revision",
          error: invalidateError,
          user: currentUser ?? undefined,
        });
      }

      return result;
    } catch (error) {
      captureApiError({
        hook: "useCreateRevision",
        api: PO_REVISION_APIS.makeRevision,
        feature: "po-revision",
        entity_id: payload.po_id,
        error,
        user: currentUser ?? undefined,
      });
      throw error;
    }
  };

  return { createRevision, loading };
};

// ─── Approve Revision ────────────────────────────────────────

export const useApproveRevision = () => {
  const { call, loading } = useFrappePostCall(PO_REVISION_APIS.approveRevision);
  const { mutate } = useSWRConfig();
  const { currentUser } = useFrappeAuth();

  const approveRevision = async (
    revisionId: string,
    poId?: string
  ) => {
    try {
      const result = await call({ revision_name: revisionId });

      try {
        // Invalidate all related caches
        await Promise.all([
          mutate(poRevisionKeys.revisionDoc(revisionId)),
          ...(poId
            ? [
                mutate(poRevisionKeys.originalPO(poId)),
                mutate(poRevisionKeys.revisionHistory(poId)),
                mutate(poRevisionKeys.lockCheck(poId)),
                // Refetch PO on PurchaseOrder.tsx details page (items, status, payment terms changed)
                mutate(["Procurement Orders", poId]),
              ]
            : []),
        ]);
      } catch (invalidateError) {
        captureApiError({
          hook: "useApproveRevision",
          api: "SWR Invalidation",
          feature: "po-revision",
          error: invalidateError,
          user: currentUser ?? undefined,
        });
      }

      return result;
    } catch (error) {
      captureApiError({
        hook: "useApproveRevision",
        api: PO_REVISION_APIS.approveRevision,
        feature: "po-revision",
        entity_id: revisionId,
        error,
        user: currentUser ?? undefined,
      });
      throw error;
    }
  };

  return { approveRevision, loading };
};

// ─── Reject Revision ─────────────────────────────────────────

export const useRejectRevision = () => {
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const { mutate } = useSWRConfig();
  const { currentUser } = useFrappeAuth();

  const rejectRevision = async (
    revisionId: string,
    poId?: string
  ) => {
    try {
      const result = await updateDoc(PO_REVISION_DOCTYPE, revisionId, {
        status: "Rejected",
      });

      try {
        // Invalidate related caches
        await Promise.all([
          mutate(poRevisionKeys.revisionDoc(revisionId)),
          ...(poId
            ? [
                mutate(poRevisionKeys.lockCheck(poId)),
                mutate(poRevisionKeys.revisionHistory(poId)),
                // Refetch PO on PurchaseOrder.tsx (lock banner removed)
                mutate(["Procurement Orders", poId]),
              ]
            : []),
        ]);
      } catch (invalidateError) {
        captureApiError({
          hook: "useRejectRevision",
          api: "SWR Invalidation",
          feature: "po-revision",
          error: invalidateError,
          user: currentUser ?? undefined,
        });
      }

      return result;
    } catch (error) {
      captureApiError({
        hook: "useRejectRevision",
        api: "Update Doc (Reject)",
        feature: "po-revision",
        doctype: PO_REVISION_DOCTYPE,
        entity_id: revisionId,
        error,
        user: currentUser ?? undefined,
      });
      throw error;
    }
  };

  return { rejectRevision, loading };
};

