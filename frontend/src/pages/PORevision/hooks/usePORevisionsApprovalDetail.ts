import { useState } from "react";
import {
  useRevisionDoc,
  useOriginalPO,
} from "../data/usePORevisionQueries";
import {
  useApproveRevision,
  useRejectRevision,
} from "../data/usePORevisionMutations";


export const usePORevisionsApprovalDetail = (revisionIdFromUrl?: string) => {
    const revisionId = revisionIdFromUrl ? revisionIdFromUrl.replace(/&=/g, "/") : undefined;
    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);

    // ─── Centralized Queries ────────────────────────────────
    const {
        data: revisionDoc,
        isLoading: revisionLoading,
        error: revisionError,
        mutate: mutateRevision,
    } = useRevisionDoc(revisionId);

    const poId = revisionDoc?.revised_po;

    const { data: originalPO, isLoading: poLoading } = useOriginalPO(poId);

    // ─── Centralized Mutations ──────────────────────────────
    const { approveRevision: doApprove } = useApproveRevision();
    const { rejectRevision: doReject } = useRejectRevision();

    const approveRevision = async () => {
        if (!revisionId) return;
        setIsApproving(true);
        try {
            await doApprove(revisionId, poId);
            await mutateRevision();
        } catch (err) {
            console.error("Failed to approve PO revision", err);
            throw err;
        } finally {
            setIsApproving(false);
        }
    };

    const rejectRevision = async () => {
        if (!revisionId) return;
        setIsRejecting(true);
        try {
            await doReject(revisionId, poId);
            await mutateRevision();
        } catch (err) {
            console.error("Failed to reject PO revision", err);
            throw err;
        } finally {
            setIsRejecting(false);
        }
    };

    return {
        revisionDoc,
        originalPO,
        isLoading: revisionLoading,
        isContextLoading: poLoading,
        isApproving,
        isRejecting,
        error: revisionError,
        approveRevision,
        rejectRevision,
        mutateRevision
    };
};
