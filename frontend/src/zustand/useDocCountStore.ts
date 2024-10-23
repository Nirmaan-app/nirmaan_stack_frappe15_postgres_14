import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ProcurementData {
    workflow_state: string;
    procurement_list: any[];
}

interface SentBackDataType {
    workflow_state: string;
    item_list: any[];
}

interface PODataType {
    status: string;
}

interface StoreState {
    pendingPRCount: number | null;
    approvePRCount: number | null;
    adminPendingPRCount: number | null;
    adminApprovePRCount: number | null;
    setPendingPRCount: (count: number) => void;
    setApprovePRCount: (count: number) => void;
    updatePRCounts: (prData: ProcurementData[], admin: boolean) => void;
    adminNewSBCount: number | null;
    newSBCount: number | null;
    updateSBCounts: (sbData: SentBackDataType[], admin: boolean) => void;
    amendPOCount: number | null;
    adminAmendPOCount: number | null;
    updatePOCounts: (poData: PODataType[], admin: boolean) => void;
}

export const useDocCountStore = create<StoreState>()(
    persist(
        (set) => ({
            pendingPRCount: null,
            approvePRCount: null,
            adminPendingPRCount: null,
            adminApprovePRCount: null,
            adminNewSBCount: null,
            newSBCount: null,
            amendPOCount: null,
            adminAmendPOCount: null,
            setPendingPRCount: (count) => set({ pendingPRCount: count }),
            setApprovePRCount: (count) => set({ approvePRCount: count }),
            updatePRCounts: (prData, admin) => {
                const pendingCount = prData.filter((pr) => pr.workflow_state === 'Pending').length;
                const approveCount = prData.filter((pr) => ['Vendor Selected', 'Partially Approved'].includes(pr.workflow_state) && pr?.procurement_list?.list?.some((i) => i?.status === "Pending")).length;
                if(admin) {
                    set({
                        adminPendingPRCount: pendingCount,
                        adminApprovePRCount: approveCount,
                    });
                } else {
                    set({
                        pendingPRCount: pendingCount,
                        approvePRCount: approveCount,
                    });
                }
            },
            updateSBCounts: (sbData, admin) => {
                const newSBCount = sbData.filter((sb) => sb?.item_list?.list?.some((i) => i?.status === "Pending")).length;
                if(admin) {
                    set({
                        adminNewSBCount: newSBCount
                    });
                } else {
                    set({
                        newSBCount: newSBCount
                    });
                }
            },
            updatePOCounts: (poData, admin) => {
                const amendPOCount = poData?.length
                if(admin) {
                    set({
                        adminAmendPOCount: amendPOCount
                    });
                } else {
                    set({
                        amendPOCount: amendPOCount
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
