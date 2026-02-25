import { useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useState } from "react";


export const usePORevisionsApprovalDetail = (revisionId?: string) => {
    // Provide doctype to the hook if supported, otherwise provide it to updateDoc
    const { updateDoc } = useFrappeUpdateDoc();
    
    // Provide method to the hook to get a specialized call
    const { call: approveCall } = useFrappePostCall("nirmaan_stack.api.po_revisions.revision_logic.on_approval_revision");
    
    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);

    // 1. Fetch the Revision document
    const { data: revisionDoc, isLoading: revisionLoading, error: revisionError, mutate: mutateRevision } = useFrappeGetDoc(
        "PO Revisions",
        revisionId || "",
        revisionId ? undefined : null
    );

    const poId = revisionDoc?.revised_po;

    // 2. Fetch the Original PO document
    const { data: originalPO, isLoading: poLoading } = useFrappeGetDoc(
        "Procurement Orders",
        poId || "",
        poId ? undefined : null
    );

    // 3. Fetch invoices linked to the PO
    const { data: invoices, isLoading: invoicesLoading } = useFrappeGetDocList("Vendor Invoices", {
        fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "status", "uploaded_by", "owner"],
        filters: poId ? [
            ["document_type", "=", "Procurement Orders"],
            ["document_name", "=", poId]
        ] : [],
        limit: 1000
    }, poId ? `VendorInvoices-PO-${poId}` : null);

    const approveRevision = async () => {
        if (!revisionId) return;
        setIsApproving(true);
        try {
            await approveCall({
                revision_name: revisionId
            });
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
            // updateDoc needs (doctype, name, doc)
            await updateDoc("PO Revisions", revisionId, {
                status: "Rejected",
            });
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
        invoices,
        isLoading: revisionLoading,
        isContextLoading: poLoading || invoicesLoading,
        isApproving,
        isRejecting,
        error: revisionError,
        approveRevision,
        rejectRevision,
        mutateRevision
    };
};
