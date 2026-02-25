import { Link, useNavigate, useParams } from "react-router-dom";
import { usePORevisionsApprovalDetail } from "./hooks/usePORevisionsApprovalDetail";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";

import PORevisionInfoCard from "./components/detail/PORevisionInfoCard";
import PORevisionInvoices from "./components/detail/PORevisionInvoices";
import PORevisionImpactAndJustification from "./components/detail/PORevisionImpactAndJustification";
import PORevisionLineItems from "./components/detail/PORevisionLineItems";
import PORevisionPaymentRectification from "./components/detail/PORevisionPaymentRectification";

export default function PORevisionsApprovalDetail() {
    const { id } = useParams();
    const navigate = useNavigate();

    const {
        revisionDoc,
        originalPO,
        invoices,
        isLoading,
        isContextLoading,
        approveRevision,
        rejectRevision
    } = usePORevisionsApprovalDetail(id);

    if (isLoading) {
        return <div className="p-8 text-center text-slate-500">Loading PO Revision details...</div>;
    }

    if (!revisionDoc) {
        return <div className="p-8 text-center text-red-500">PO Revision not found!</div>;
    }
    // Safely parse JSON arrays for revision line items
    let parsedItems = [];
    try {
        parsedItems = typeof revisionDoc.revision_items === "string" 
            ? JSON.parse(revisionDoc.revision_items) 
            : (revisionDoc.revision_items || []);
    } catch {
        parsedItems = [];
    }

    // Calculate totals for Impact Summary
    const beforeExclGst = Number(originalPO?.amount || 0);
    const beforeInclGst = Number(originalPO?.total_amount || 0);
    
    // Calculate the 'After' state by iterating through items (excluding Deleted)
    const afterExclGst = parsedItems.reduce((acc, item) => {
        if (item.item_type === "Deleted") return acc;
        const amount = (item.item_type === "Original") 
            ? (item.original_amount || (Number(item.original_qty || 0) * Number(item.original_rate || 0)) || 0)
            : (item.revision_amount || (Number(item.revision_qty || 0) * Number(item.revision_rate || 0)) || item.original_amount || 0);
        return acc + Number(amount);
    }, 0);

    const afterInclGst = parsedItems.reduce((acc, item) => {
        if (item.item_type === "Deleted") return acc;
        const amount = (item.item_type === "Original") 
            ? (item.original_amount || (Number(item.original_qty || 0) * Number(item.original_rate || 0)) || 0)
            : (item.revision_amount || (Number(item.revision_qty || 0) * Number(item.revision_rate || 0)) || item.original_amount || 0);
        const tax = (item.item_type === "Original")
            ? (item.original_tax || 0)
            : (item.revision_tax ?? item.original_tax ?? 0);
        return acc + (Number(amount) * (1 + (Number(tax) / 100)));
    }, 0);

    return (
        <div className="flex flex-col h-full bg-slate-50/50 p-4 md:p-6 pb-20 overflow-y-auto">
            
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-3">
                    {/* <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full h-8 w-8 hover:bg-slate-200">
                        <ArrowLeft className="w-5 h-5 text-slate-700" />
                    </Button> */}
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-slate-900">PO Revision Review</h1>
                        {revisionDoc.status === "Pending" ? (
                            <span className="inline-flex bg-blue-100 text-blue-700 px-2.5 py-1 text-xs font-semibold rounded-md">
                                Pending
                            </span>
                        ) : (
                            <span className="inline-flex bg-slate-200 text-slate-800 px-2.5 py-1 text-xs font-semibold rounded-md">
                                {revisionDoc.status || "Draft"}
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                {revisionDoc.status === "Pending" && (
                    <div className="flex items-center gap-3">
                        <Button variant="outline" className="text-red-500 border-red-500 hover:bg-red-50 hover:text-red-600" onClick={rejectRevision}>
                            Reject Revision
                        </Button>
                        <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={approveRevision}>
                            Approve Revision
                        </Button>
                    </div>
                )}
            </div>
            
            <p className="items-center text-sm border-b pb-4 text-slate-500 ml-11">
                Review changes requested for Purchase Order{" "}
                <Link to={`/purchase-orders/${revisionDoc.revised_po?.split("/").join("&=")}?tab=${originalPO?.status || "Approved%20PO"}`} className="font-medium text-blue-600 hover:underline inline-flex items-center gap-1">
                    #{revisionDoc.revised_po}
                    <ExternalLink className="w-3 h-3" />
                </Link>
            </p>

            <div className="ml-11 mt-2">
                {/* Metadata Card */}
                <PORevisionInfoCard 
                    vendor={originalPO?.vendor || revisionDoc.vendor_name || revisionDoc.vendor || "Loading..."}
                    project={revisionDoc.project || "N/A"}
                    workPackage={originalPO?.work_package || "N/A"}
                    dispatched={originalPO?.dispatch_date ? new Date(originalPO.dispatch_date).toLocaleDateString() : "Pending"}
                    currentTotal={originalPO?.total_amount || 0}
                />

                <div className="mt-6 flex flex-col gap-6">
                    {/* Invoices */}
                    <PORevisionInvoices invoices={invoices || []} isLoading={isContextLoading} />

                    {/* Impact and Justification */}
                    <PORevisionImpactAndJustification 
                        beforeExclGst={beforeExclGst}
                        afterExclGst={afterExclGst}
                        beforeInclGst={beforeInclGst}
                        afterInclGst={afterInclGst}
                        justification={revisionDoc.revision_justification}
                    />

                    {/* Line Items */}
                    <PORevisionLineItems items={parsedItems} />

                    {/* Payment Rectification */}
                    {revisionDoc.payment_return_details && (
                        <PORevisionPaymentRectification paymentData={revisionDoc.payment_return_details} />
                    )}
                </div>
            </div>
        </div>
    );
}
