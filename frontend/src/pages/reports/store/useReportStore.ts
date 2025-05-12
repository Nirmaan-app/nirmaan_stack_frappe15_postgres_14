import { create } from 'zustand';
import { REPORTS_TABS } from '../constants'; // Adjust path

export type ProjectReportType = 'Cash Sheet';
export type POReportType = 'Pending Invoices' | 'PO with Excess Payments';
export type ReportType = ProjectReportType | POReportType | null; // Allow null initially

interface ReportState {
    // Keep track of the *type* of report selected for export/filtering
    selectedReportType: ReportType;
    setSelectedReportType: (type: ReportType) => void;

    // Helper to set the default type when the main tab changes
    setDefaultReportType: (activeTab: string) => void;
}

const getDefaultReportType = (tab: string): ReportType => {
    if (tab === REPORTS_TABS.PROJECTS) {
        return 'Cash Sheet';
    } else if (tab === REPORTS_TABS.PO) {
        // Default to one of the PO options, e.g., Pending Invoices
        return 'Pending Invoices';
    }
    return null;
};

export const useReportStore = create<ReportState>((set) => ({
    selectedReportType: getDefaultReportType(REPORTS_TABS.PROJECTS), // Initialize with default for the initial tab

    setSelectedReportType: (type) => set({ selectedReportType: type }),

    setDefaultReportType: (activeTab) => set({ selectedReportType: getDefaultReportType(activeTab) }),
}));