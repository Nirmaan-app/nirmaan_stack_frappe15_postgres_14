import { create } from "zustand";

interface TabCounts {
    pending: number;
    approved: number;
    rejected: number;
    all: number;
}

type TabType = "Pending Approval" | "Approved" | "Rejected" | "All TDS";

interface TDSStore {
    activeTab: TabType;
    tabCounts: TabCounts;
    setActiveTab: (tab: TabType) => void;
    setTabCounts: (counts: TabCounts) => void;
}

export const useTDSStore = create<TDSStore>((set) => ({
    activeTab: "Pending Approval",
    tabCounts: { pending: 0, approved: 0, rejected: 0, all: 0 },
    setActiveTab: (tab) => set({ activeTab: tab }),
    setTabCounts: (counts) => set({ tabCounts: counts }),
}));
