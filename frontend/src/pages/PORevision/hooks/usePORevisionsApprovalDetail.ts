import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";


export const usePORevisionsApprovalDetail = (revisionId?: string) => {
    const { updateDoc } = useFrappeUpdateDoc();

    console.log("revisionId",revisionId)
    // 1. Fetch the Revision document
    const { data: revisionDoc, isLoading: revisionLoading, error: revisionError, mutate: mutateRevision } = useFrappeGetDoc(
        "PO Revisions",
        revisionId || "",
        revisionId ? undefined : null
    );

    console.log("revisionDoc",revisionDoc,revisionLoading,revisionError)

    const poId = revisionDoc?.revised_po;

    // 2. Fetch the Original PO document (for context if needed, e.g. dispatch date, vendor names, etc.)
    const { data: originalPO, isLoading: poLoading } = useFrappeGetDoc(
        "Procurement Orders",
        poId || "",
        poId ? undefined : null
    );

    // 3. Fetch invoices linked to the PO
    const { data: invoices, isLoading: invoicesLoading } = useFrappeGetDocList("Vendor Invoices", {
        fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "status"],
        filters: poId ? [
            ["document_type", "=", "Procurement Orders"],
            ["document_name", "=", poId]
        ] : [],
        limit: 1000
    }, poId ? `VendorInvoices-PO-${poId}` : null);

    const approveRevision = async () => {
        if (!revisionId) return;
        try {
            await updateDoc("PO Revisions", revisionId, {
                status: "Approved",
            });
            mutateRevision();
        } catch (err) {
            console.error("Failed to approve PO revision", err);
        }
    };

    const rejectRevision = async () => {
        if (!revisionId) return;
        try {
            await updateDoc("PO Revisions", revisionId, {
                status: "Rejected",
            });
            mutateRevision();
        } catch (err) {
            console.error("Failed to reject PO revision", err);
        }
    };

    return {
        revisionDoc,
        originalPO,
        invoices,
        isLoading: revisionLoading,
        isContextLoading: poLoading || invoicesLoading,
        error: revisionError,
        approveRevision,
        rejectRevision,
        mutateRevision
    };
};
