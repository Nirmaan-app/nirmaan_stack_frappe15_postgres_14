import { create } from 'zustand';
import { REPORTS_TABS } from '../constants'; // Adjust path

export type ProjectReportType = 'Cash Sheet';
// Define the specific report options for POs
export type POReportOption = 'Pending Invoices' | 'PO with Excess Payments' | 'Dispatched for 3 days';

// Define the specific report options for SRs (as per your request)
// The 'value' for "Excess Payments" will be 'PO with Excess Payments'
export type SROption = 'Pending Invoices' | 'PO with Excess Payments';

// Combined type for any selectable report
export type ReportType = ProjectReportType | POReportOption | SROption | null;

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
    } else if (tab === REPORTS_TABS.PO || tab === REPORTS_TABS.SR) {
        // Default to one of the PO options, e.g., Pending Invoices
        return 'Pending Invoices';
    }
    return null;
};

export const useReportStore = create<ReportState>((set) => ({
    selectedReportType: getDefaultReportType(REPORTS_TABS.PROJECTS), // Initialize with default for the initial tab

    setSelectedReportType: (type) => set({ selectedReportType: type }),

    setDefaultReportType: (activeTab) => {
        // Only update if the current selected type is not valid for the new tab,
        // or to set a sensible default.
        const newDefault = getDefaultReportType(activeTab);
        // This ensures that if a report type is already selected and valid for the new tab, it remains.
        // However, the requirement is to set the default for the tab.
        set({ selectedReportType: newDefault });
    }
}));