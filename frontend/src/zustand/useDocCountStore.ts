import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ProcurementData {
    workflow_state: string;
    procurement_list: any[];
}

interface SentBackDataType {
    workflow_state: string;
    item_list: any[];
    type: string;
}

interface PODataType {
    status: string;
}

interface PRCounts {
    pending: number | null;
    approve: number | null;
    approved: number | null;
    inProgress: number | null;
}

interface NewSBCounts {
    rejected : number | null;
    delayed: number | null;
    cancelled: number | null;
}

interface PaymentCountsInterface {
    rejected : number | null;
    requested: number | null;
    approved: number | null;
    paid: number | null;
}

interface StoreState {
    prCounts: PRCounts;
    adminPrCounts: PRCounts;
    updatePRCounts: (prData: ProcurementData[], admin: boolean) => void;
    adminNewApproveSBCount: number | null;
    newSBApproveCount: number | null;
    updateSBCounts: (sbData: SentBackDataType[], admin: boolean) => void;
    amendPOCount: number | null;
    adminAmendPOCount: number | null;
    updatePOCounts: (poData: PODataType[], admin: boolean) => void;
    newPOCount: number | null;
    adminNewPOCount: number | null;
    newSBCounts : NewSBCounts;
    adminNewSBCounts: NewSBCounts;
    dispatchedPOCount: number | null;
    adminDispatchedPOCount: number | null;
    otherPOCount: number | null;
    adminOtherPOCount: number | null;
    updateSRCounts: (srData : any, admin: boolean) => void;
    selectedSRCount: number | null;
    adminSelectedSRCount: number | null;
    approvedSRCount : number | null;
    adminApprovedSRCount : number | null;
    allSRCount: number | null;
    adminAllSRCount: number | null;
    pendingSRCount: number | null;
    adminPendingSRCount: number | null;
    amendedSRCount: number | null;
    adminAmendedSRCount: number | null;
    paymentsCount: PaymentCountsInterface;
    adminPaymentsCount: PaymentCountsInterface;
    updatePaymentsCount: (paymentData : any, admin: boolean) => void;
}

export const useDocCountStore = create<StoreState>()(
    persist(
        (set) => ({
            prCounts: {pending: 0, approve: 0, approved: 0, inProgress: 0},
            adminPrCounts: {pending: 0, approve: 0, approved: 0, inProgress: 0},
            amendedSRCount: 0,
            adminAmendedSRCount: 0,
            adminNewApproveSBCount: 0,
            newSBApproveCount: 0,
            amendPOCount: 0,
            adminAmendPOCount: 0,
            newPOCount: 0,
            adminNewPOCount: 0,
            otherPOCount: 0,
            adminOtherPOCount: 0,
            dispatchedPOCount: 0,
            adminDispatchedPOCount: 0,
            newSBCounts: { rejected: 0, delayed: 0, cancelled: 0},
            adminNewSBCounts: { rejected: 0, delayed: 0, cancelled: 0},
            selectedSRCount: 0,
            adminSelectedSRCount: 0,
            approvedSRCount : 0,
            adminApprovedSRCount : 0,
            allSRCount: 0,
            adminAllSRCount: 0,
            pendingSRCount: 0,
            adminPendingSRCount: 0,
            paymentsCount: {requested: 0, approved: 0, rejected: 0, paid: 0},
            adminPaymentsCount: {requested: 0, approved: 0, rejected: 0, paid: 0},
            updatePRCounts: (prData, admin) => {
                const pendingCount = prData.filter((pr) => pr.workflow_state === 'Pending').length;
                const approveCount = prData.filter((pr) => ['Vendor Selected', 'Partially Approved'].includes(pr.workflow_state) && pr?.procurement_list?.list?.some((i) => i?.status === "Pending")).length;
                const approvedCount = prData.filter((pr) => pr.workflow_state === 'Approved')?.length
                // const updateQuotePRCount = prData.filter((pr) => pr.workflow_state === "RFQ Generated").length
                // const chooseVendorPRCount = prData.filter((pr) => pr.workflow_state === "Quote Updated").length
                const inProgressPRCount = prData.filter((pr) => pr.workflow_state === "In Progress").length
                if(admin) {
                    set({
                        adminPrCounts: {pending: pendingCount, approve: approveCount, approved: approvedCount, inProgress: inProgressPRCount},
                        // adminPendingPRCount: pendingCount,
                        // adminApprovePRCount: approveCount,
                        // adminApprovedPRCount: approvedCount,
                        // adminUpdateQuotePRCount: updateQuotePRCount,
                        // adminChooseVendorPRCount: chooseVendorPRCount
                        // adminInProgressPRCount: inProgressPRCount
                    });
                } else {
                    set({
                        prCounts: {pending: pendingCount, approve: approveCount, approved: approvedCount, inProgress: inProgressPRCount},
                        // pendingPRCount: pendingCount,
                        // approvePRCount: approveCount,
                        // approvedPRCount: approvedCount,
                        // updateQuotePRCount: updateQuotePRCount,
                        // chooseVendorPRCount: chooseVendorPRCount
                        // inProgressPRCount: inProgressPRCount
                    });
                }
            },
            updateSBCounts: (sbData, admin) => {
                const approveSBCount = sbData.filter((sb) => ["Vendor Selected", "Partially Approved"].includes(sb?.workflow_state) && sb?.item_list?.list?.some((i) => i?.status === "Pending")).length;
                const newRejectedSBCount = sbData.filter((sb) => sb?.workflow_state === "Pending" && sb?.type === "Rejected").length
                const newDelayedSBCount = sbData.filter((sb) => sb?.workflow_state === "Pending" && sb?.type === "Delayed").length
                const newCancelledSBCount = sbData.filter((sb) => sb?.workflow_state === "Pending" && sb?.type === "Cancelled").length

                if(admin) {
                    set({
                        adminNewApproveSBCount: approveSBCount,
                        adminNewSBCounts : {rejected : newRejectedSBCount, delayed: newDelayedSBCount, cancelled: newCancelledSBCount}
                    });
                } else {
                    set({
                        newSBApproveCount: approveSBCount,
                        newSBCounts : {rejected : newRejectedSBCount, delayed: newDelayedSBCount, cancelled: newCancelledSBCount}
                    });
                }
            },
            updatePOCounts: (poData, admin) => {
                const amendPOCount = poData?.filter((po) => po?.status === "PO Amendment")?.length
                const newPOCount = poData?.filter((po) =>  ["PO Approved"].includes(po?.status))?.length
                const dispatchedPOCount = poData?.filter((po) => po?.status === "Dispatched")?.length
                const otherPOCount = poData?.filter((po) =>  !["PO Approved", "PO Amendment", "Merged", "Dispatched"].includes(po?.status))?.length
                if(admin) {
                    set({
                        adminAmendPOCount: amendPOCount,
                        adminNewPOCount: newPOCount,
                        adminOtherPOCount: otherPOCount,
                        adminDispatchedPOCount: dispatchedPOCount
                    });
                } else {
                    set({
                        amendPOCount: amendPOCount,
                        newPOCount: newPOCount,
                        otherPOCount: otherPOCount,
                        dispatchedPOCount: dispatchedPOCount
                    });
                }
            },
            updateSRCounts : (srData, admin) => {
                const selectedSRCount = srData?.filter((sr) => ["Vendor Selected"].includes(sr?.status))?.length
                const approvedSRCount = srData?.filter((sr) => sr?.status === "Approved")?.length
                const allSRCount = srData?.length
                const pendingSRCount = srData?.filter((sr) => !["Vendor Selected", "Approved", "Amendment"].includes(sr?.status))?.length

                const amendedSRCount = srData?.filter((sr) => sr?.status === "Amendment")?.length

                if(admin) {
                    set({
                        adminSelectedSRCount: selectedSRCount,
                        adminApprovedSRCount: approvedSRCount,
                        adminAllSRCount: allSRCount,
                        adminPendingSRCount: pendingSRCount,
                        adminAmendedSRCount: amendedSRCount
                    });
                } else {
                    set({
                        selectedSRCount: selectedSRCount,
                        approvedSRCount: approvedSRCount,
                        allSRCount: allSRCount,
                        pendingSRCount: pendingSRCount,
                        amendedSRCount: amendedSRCount
                    });
                }
            },
            updatePaymentsCount: (paymentData, admin) => {
                const approvedPaymentsCount = paymentData?.filter((p) => p?.status === "Approved")?.length
                const rejectedPaymentsCount = paymentData?.filter((p) => p?.status === "Rejected")?.length
                const requestedPaymentsCount = paymentData?.filter((p) => p?.status === "Requested")?.length
                const paidPaymentsCount = paymentData?.filter((p) => p?.status === "Paid")?.length

                if(admin) {
                    set({
                        adminPaymentsCount: {requested: requestedPaymentsCount, approved: approvedPaymentsCount, rejected: rejectedPaymentsCount, paid: paidPaymentsCount}
                    });
                } else {
                    set({
                        paymentsCount: {requested: requestedPaymentsCount, approved: approvedPaymentsCount, rejected: rejectedPaymentsCount, paid: paidPaymentsCount}
                    });
                }
            },
        }),
        {
            name: 'docCounts-store',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
);
