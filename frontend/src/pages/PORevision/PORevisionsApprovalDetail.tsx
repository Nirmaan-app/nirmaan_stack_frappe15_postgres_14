import { Link, useNavigate, useParams } from "react-router-dom";
import { usePORevisionsApprovalDetail } from "./hooks/usePORevisionsApprovalDetail";
import { Button } from "@/components/ui/button";
import { ExternalLink, Building2, FolderOpen } from "lucide-react";

import PORevisionImpactAndJustification from "./components/detail/PORevisionImpactAndJustification";
import PORevisionLineItems from "./components/detail/PORevisionLineItems";

export default function PORevisionsApprovalDetail() {
    const { id } = useParams();
    const navigate = useNavigate();

    const {
        revisionDoc,
        originalPO,
        isLoading,
        isApproving,
        isRejecting,
        approveRevision,
        rejectRevision
    } = usePORevisionsApprovalDetail(id);

    const handleApprove = async () => {
        try {
            await approveRevision();
            navigate("/purchase-orders?tab=Approve+PO+Revision");
        } catch (err) {
            alert("Failed to approve revision. Please try again.");
        }
    };

    const handleReject = async () => {
        try {
            await rejectRevision();
            navigate("/purchase-orders?tab=Approve+PO+Revision");
        } catch (err) {
            alert("Failed to reject revision. Please try again.");
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-slate-500">Loading PO Revision details...</div>;
    }

    if (!revisionDoc) {
        return <div className="p-8 text-center text-red-500">PO Revision not found!</div>;
    }

    let parsedItems = [];
    try {
        parsedItems = typeof revisionDoc.revision_items === "string"
            ? JSON.parse(revisionDoc.revision_items)
            : (revisionDoc.revision_items || []);
    } catch {
        parsedItems = [];
    }

    // Calculate totals for Impact Summary
    const beforeExclGst = parsedItems.reduce((acc: number, item: Record<string, unknown>) => {
        if (item.item_type === "New") return acc;
        const amount = Number(item.original_amount || (Number(item.original_qty || 0) * Number(item.original_rate || 0)) || 0);
        return acc + amount;
    }, 0);

    const beforeInclGst = parsedItems.reduce((acc: number, item: Record<string, unknown>) => {
        if (item.item_type === "New") return acc;
        const amount = Number(item.original_amount || (Number(item.original_qty || 0) * Number(item.original_rate || 0)) || 0);
        const tax = Number(item.original_tax || 0);
        return acc + (amount * (1 + tax / 100));
    }, 0);

    const afterExclGst = parsedItems.reduce((acc: number, item: Record<string, unknown>) => {
        if (item.item_type === "Deleted") return acc;
        const amount = (item.item_type === "Original")
            ? Number(item.original_amount || (Number(item.original_qty || 0) * Number(item.original_rate || 0)) || 0)
            : Number(item.revision_amount || (Number(item.revision_qty || 0) * Number(item.revision_rate || 0)) || 0);
        return acc + amount;
    }, 0);

    const afterInclGst = parsedItems.reduce((acc: number, item: Record<string, unknown>) => {
        if (item.item_type === "Deleted") return acc;
        const amount = (item.item_type === "Original")
            ? Number(item.original_amount || (Number(item.original_qty || 0) * Number(item.original_rate || 0)) || 0)
            : Number(item.revision_amount || (Number(item.revision_qty || 0) * Number(item.revision_rate || 0)) || 0);
        const tax = (item.item_type === "Original")
            ? Number(item.original_tax || 0)
            : Number(item.revision_tax ?? item.original_tax ?? 0);
        return acc + (amount * (1 + tax / 100));
    }, 0);

    const vendorName = revisionDoc?.vendor_name || originalPO?.vendor_name || revisionDoc?.vendor || originalPO?.vendor || "—";
    const projectName = revisionDoc?.project_name || originalPO?.project_name || revisionDoc?.project || originalPO?.project || "—";

    const statusBadge = revisionDoc.status === "Pending"
        ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20"
        : revisionDoc.status === "Approved"
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
            : revisionDoc.status === "Rejected"
                ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20"
                : "bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-600/20";

    return (
        <div className="flex flex-col h-full bg-gray-50/60 overflow-y-auto">
            {/* ── Compact Header ── */}
            <div className="bg-white border-b px-4 md:px-6 py-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <h1 className="text-base font-bold text-gray-900 shrink-0">PO Revision Review</h1>
                        <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-md shrink-0 ${statusBadge}`}>
                            {revisionDoc.status || "Draft"}
                        </span>
                        <span className="text-gray-300 hidden sm:inline">|</span>
                        <Link
                            to={`/purchase-orders/${revisionDoc.revised_po?.replaceAll("/", "&=")}?tab=${originalPO?.status || "Approved%20PO"}`}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 shrink-0"
                        >
                            {revisionDoc.revised_po}
                            <ExternalLink className="w-3 h-3" />
                        </Link>
                    </div>

                    {revisionDoc.status === "Pending" && (
                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 h-8 text-xs"
                                onClick={handleReject}
                                disabled={isApproving || isRejecting}
                            >
                                {isRejecting ? "Rejecting..." : "Reject"}
                            </Button>
                            <Button
                                size="sm"
                                className="bg-primary hover:bg-primary/90 text-white h-8 text-xs"
                                onClick={handleApprove}
                                disabled={isApproving || isRejecting}
                            >
                                {isApproving ? "Approving..." : "Approve Revision"}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Integrated Vendor + Project metadata */}
                <div className="flex items-center gap-4 mt-2.5 text-xs text-gray-500">
                    <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-gray-400" />
                        <span className="font-medium text-gray-700" title={vendorName}>{vendorName}</span>
                    </div>
                    <span className="text-gray-300">·</span>
                    <div className="flex items-center gap-1.5">
                        <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
                        <span className="font-medium text-gray-700" title={projectName}>{projectName}</span>
                    </div>
                </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 px-4 md:px-6 py-5 space-y-5 pb-20">
                {/* Impact and Justification */}
                <PORevisionImpactAndJustification
                    beforeExclGst={beforeExclGst}
                    afterExclGst={afterExclGst}
                    beforeInclGst={beforeInclGst}
                    afterInclGst={afterInclGst}
                    justification={revisionDoc.revision_justification}
                />

                {/* Line Items */}
                <PORevisionLineItems items={parsedItems} isCustom={!!originalPO?.custom} />
            </div>
        </div>
    );
}
