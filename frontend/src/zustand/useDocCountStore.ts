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

interface NewSBCounts {
    rejected : number | null;
    delayed: number | null;
    cancelled: number | null;
}

interface AdminNewSBCounts {
    rejected : number | null;
    delayed: number | null;
    cancelled: number | null;
}

interface StoreState {
    pendingPRCount: number | null;
    approvePRCount: number | null;
    adminPendingPRCount: number | null;
    adminApprovePRCount: number | null;
    adminApprovedPRCount: number | null;
    approvedPRCount: number | null;
    setPendingPRCount: (count: number) => void;
    setApprovePRCount: (count: number) => void;
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
    adminNewSBCounts: AdminNewSBCounts;
    updateQuotePRCount: number | null;
    adminUpdateQuotePRCount: number | null;
    chooseVendorPRCount: number | null;
    adminChooseVendorPRCount: number | null;
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
}

export const useDocCountStore = create<StoreState>()(
    persist(
        (set) => ({
            amendedSRCount: null,
            adminAmendedSRCount: null,
            pendingPRCount: null,
            approvePRCount: null,
            adminPendingPRCount: null,
            adminApprovePRCount: null,
            adminApprovedPRCount: null,
            approvedPRCount: null,
            adminNewApproveSBCount: null,
            newSBApproveCount: null,
            amendPOCount: null,
            adminAmendPOCount: null,
            newPOCount: null,
            updateQuotePRCount: null,
            adminUpdateQuotePRCount: null,
            chooseVendorPRCount: null,
            adminChooseVendorPRCount: null,
            adminNewPOCount: null,
            otherPOCount: null,
            adminOtherPOCount: null,
            newSBCounts: { rejected: null, delayed: null, cancelled: null},
            adminNewSBCounts: { rejected: null, delayed: null, cancelled: null},
            setPendingPRCount: (count) => set({ pendingPRCount: count }),
            setApprovePRCount: (count) => set({ approvePRCount: count }),
            selectedSRCount: null,
            adminSelectedSRCount: null,
            approvedSRCount : null,
            adminApprovedSRCount : null,
            allSRCount: null,
            adminAllSRCount: null,
            pendingSRCount: null,
            adminPendingSRCount: null,
            updatePRCounts: (prData, admin) => {
                const pendingCount = prData.filter((pr) => pr.workflow_state === 'Pending').length;
                const approveCount = prData.filter((pr) => ['Vendor Selected', 'Partially Approved'].includes(pr.workflow_state) && pr?.procurement_list?.list?.some((i) => i?.status === "Pending")).length;
                const approvedCount = prData.filter((pr) => pr.workflow_state === 'Approved')?.length
                const updateQuotePRCount = prData.filter((pr) => pr.workflow_state === "RFQ Generated").length
                const chooseVendorPRCount = prData.filter((pr) => pr.workflow_state === "Quote Updated").length
                if(admin) {
                    set({
                        adminPendingPRCount: pendingCount,
                        adminApprovePRCount: approveCount,
                        adminApprovedPRCount: approvedCount,
                        adminUpdateQuotePRCount: updateQuotePRCount,
                        adminChooseVendorPRCount: chooseVendorPRCount
                    });
                } else {
                    set({
                        pendingPRCount: pendingCount,
                        approvePRCount: approveCount,
                        approvedPRCount: approvedCount,
                        updateQuotePRCount: updateQuotePRCount,
                        chooseVendorPRCount: chooseVendorPRCount
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
                const otherPOCount = poData?.filter((po) =>  !["PO Approved", "PO Amendment", "Merged"].includes(po?.status))?.length
                if(admin) {
                    set({
                        adminAmendPOCount: amendPOCount,
                        adminNewPOCount: newPOCount,
                        adminOtherPOCount: otherPOCount,
                    });
                } else {
                    set({
                        amendPOCount: amendPOCount,
                        newPOCount: newPOCount,
                        otherPOCount: otherPOCount
                    });
                }
            },
            updateSRCounts : (srData, admin) => {
                const selectedSRCount = srData?.filter((sr) => ["Vendor Selected", "Edit"].includes(sr?.status))?.length
                const approvedSRCount = srData?.filter((sr) => sr?.status === "Approved")?.length
                const allSRCount = srData?.length
                const pendingSRCount = srData?.filter((sr) => !["Vendor Selected", "Approved", "Edit", "Amendment"].includes(sr?.status))?.length

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
            }
        }),
        {
            name: 'docCounts-store',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
);
