import { useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useSWRConfig } from "swr";
import {
  poRevisionKeys,
  PO_REVISION_DOCTYPE,
  PO_REVISION_APIS,
} from "./poRevision.constants";

// ─── Create Revision (Submit draft) ──────────────────────────

export const useCreateRevision = () => {
  const { call, loading } = useFrappePostCall(PO_REVISION_APIS.makeRevision);
  const { mutate } = useSWRConfig();

  const createRevision = async (payload: {
    po_id: string;
    justification: string;
    revision_items: string;
    total_amount_difference: number;
    payment_return_details: string;
  }) => {
    const result = await call(payload);

    // Invalidate lock check so Warning banner refreshes
    await mutate(poRevisionKeys.lockCheck(payload.po_id));

    return result;
  };

  return { createRevision, loading };
};

// ─── Approve Revision ────────────────────────────────────────

export const useApproveRevision = () => {
  const { call, loading } = useFrappePostCall(PO_REVISION_APIS.approveRevision);
  const { mutate } = useSWRConfig();

  const approveRevision = async (
    revisionId: string,
    poId?: string
  ) => {
    const result = await call({ revision_name: revisionId });

    // Invalidate all related caches
    await Promise.all([
      mutate(poRevisionKeys.revisionDoc(revisionId)),
      ...(poId
        ? [
            mutate(poRevisionKeys.originalPO(poId)),
            mutate(poRevisionKeys.revisionHistory(poId)),
            mutate(poRevisionKeys.lockCheck(poId)),
          ]
        : []),
    ]);

    return result;
  };

  return { approveRevision, loading };
};

// ─── Reject Revision ─────────────────────────────────────────

export const useRejectRevision = () => {
  const { updateDoc, loading } = useFrappeUpdateDoc();
  const { mutate } = useSWRConfig();

  const rejectRevision = async (
    revisionId: string,
    poId?: string
  ) => {
    const result = await updateDoc(PO_REVISION_DOCTYPE, revisionId, {
      status: "Rejected",
    });

    // Invalidate related caches
    await Promise.all([
      mutate(poRevisionKeys.revisionDoc(revisionId)),
      ...(poId
        ? [mutate(poRevisionKeys.lockCheck(poId))]
        : []),
    ]);

    return result;
  };

  return { rejectRevision, loading };
};
