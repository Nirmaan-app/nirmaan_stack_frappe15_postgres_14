import { create } from 'zustand';
import { REPORTS_TABS } from '../constants'; // Adjust path

export type ProjectReportType = 'Cash Sheet' | 'Inflow Report';
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
    setSelectedReportType: (type: ReportType | null) => void;

    // Helper to set the default type when the main tab changes
    setDefaultReportType: (activeTab: string, userRole?: string) => void;
}

// const getDefaultReportType = (tab: string): ReportType => {
//     if (tab === REPORTS_TABS.PROJECTS) {
//         return 'Cash Sheet';
//     } else if (tab === REPORTS_TABS.PO || tab === REPORTS_TABS.SR) {
//         // Default to one of the PO options, e.g., Pending Invoices
//         return 'Pending Invoices';
//     }
//     return null;
// };
// Helper to get default report type based on tab and role
const getDefaultReportTypeForTabAndRole = (tab: string, userRole?: string): ReportType => {
    if (tab === REPORTS_TABS.PROJECTS) {
        // Only Admin and Accountant see Project reports
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(userRole || "")) {
            return 'Cash Sheet';
        }
        return null; // No default if role cannot see this tab's reports
    } else if (tab === REPORTS_TABS.PO) {
        // Project Manager has a specific default for PO tab
        if (userRole === "Nirmaan Project Manager Profile") {
            return 'Dispatched for 3 days';
        }
        // Other roles (Admin, Accountant) who can see PO tab
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(userRole || "")) {
            return 'Pending Invoices'; // Default for Admin/Accountant on PO tab
        }
        return null; // No default if role cannot see this tab's reports
    } else if (tab === REPORTS_TABS.SR) {
        // Assuming SR tab is visible to Admin, Accountant, PM
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(userRole || "")) {
            return 'Pending Invoices'; // Default for SR tab for allowed roles
        }
        return null;
    }
    return null; // Default fallback
};

// export const useReportStore = create<ReportState>((set) => ({
//     selectedReportType: getDefaultReportType(REPORTS_TABS.PROJECTS), // Initialize with default for the initial tab

//     setSelectedReportType: (type) => set({ selectedReportType: type }),

//     setDefaultReportType: (activeTab) => {
//         // Only update if the current selected type is not valid for the new tab,
//         // or to set a sensible default.
//         const newDefault = getDefaultReportType(activeTab);
//         // This ensures that if a report type is already selected and valid for the new tab, it remains.
//         // However, the requirement is to set the default for the tab.
//         set({ selectedReportType: newDefault });
//     }
// }));

export const useReportStore = create<ReportState>((set, get) => ({
    // Initialize selectedReportType to null. It will be set by setDefaultReportType on mount.
    selectedReportType: null,

    setSelectedReportType: (type) => set({ selectedReportType: type }),

    setDefaultReportType: (activeTab, userRole) => {
        const newDefault = getDefaultReportTypeForTabAndRole(activeTab, userRole);
        // console.log(`setDefaultReportType called: tab=${activeTab}, role=${userRole}, newDefault=${newDefault}`);
        // Always set to the determined default for the new tab/role combination.
        // If the newDefault is null (e.g., role shouldn't see reports for this tab),
        // selectedReportType becomes null.
        set({ selectedReportType: newDefault });
    }
}));