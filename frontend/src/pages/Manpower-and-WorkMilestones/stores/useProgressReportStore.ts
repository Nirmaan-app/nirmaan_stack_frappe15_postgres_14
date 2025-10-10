

// src/stores/useProgressReportStore.ts
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';

// --- Type Definitions ---
interface FrappeManpowerDetail {
    label: string;
    count: number;
}

interface MilestoneHistoryEntry {
    date: string; // The report date when the update occurred
    previous_status: 'Not Started' | 'WIP' | 'N/A' | 'Completed' | '';
    previous_start_date?: string;
    previous_completion_date?: string;
    previous_remarks?: string;
}

export interface LocalMilestoneData {
    name: string; // Frappe name of the Work Milestone
    work_milestone_name: string;
    work_header: string;
    status: 'Not Started' | 'WIP' | 'N/A' | 'Completed';
    progress: number;
    expected_starting_date?: string;
    expected_completion_date?: string;
    remarks?: string;
    // New fields for history
    history: MilestoneHistoryEntry[];
    // New field to track if the milestone was updated in the current draft (optional, for internal use)
    is_updated?: boolean;
}

interface ProgressReportTabState {
    manpower_remarks: string;
    manpower: FrappeManpowerDetail[];
    milestones: LocalMilestoneData[];
    // Flags to indicate if data in this tab has been modified
    is_manpower_updated?: boolean;
    is_milestones_updated?: boolean;
}

interface DraftReport {
    project: string;
    report_date: string;
    report_status: 'Draft' | 'Completed'; // New status field
    frappe_doc_name: string | null; // Frappe name for 'Draft' or final 'Completed' report
    tabs_data: Record<string, ProgressReportTabState>; // Key is 'Work force' or 'Work Header Name'
}

interface ProgressReportState {
    draftReport: DraftReport | null;
}

interface ProgressReportActions {
    initializeDraft: (projectId: string, reportDate: string, allTabs: { project_work_header_name: string }[], inheritedManpower: FrappeManpowerDetail[], inheritedMilestones: LocalMilestoneData[], previousFrappeDocName: string | null) => void;
    updateManpowerData: (manpower: FrappeManpowerDetail[], remarks: string) => void;
    updateMilestone: (workHeader: string, updatedMilestone: LocalMilestoneData) => void;
    clearDraft: () => void;
    setFrappeDocName: (docName: string) => void;
    getMilestonesForHeader: (workHeader: string) => LocalMilestoneData[];
}
// -----------------------------------------------------------------

const getManpowerRolesDefault = (): FrappeManpowerDetail[] => [
    { label: "MEP Engineer", count: 0 },
    { label: "Safety Engineer", count: 0 },
    { label: "Electrical Team", count: 0 },
    { label: "Fire Fighting Team", count: 0 },
    { label: "Data & Networking Team", count: 0 },
    { label: "HVAC Team", count: 0 },
    { label: "ELV Team", count: 0 },
];


export const useProgressReportStore = create<ProgressReportState & ProgressReportActions>()(
    devtools( // For Redux DevTools integration
        persist( // For local storage persistence
            (set, get) => ({
                draftReport: null,

                initializeDraft: (projectId, reportDate, allTabs, inheritedManpower, allInheritedMilestones, previousFrappeDocName) => {
                    // This function sets up the initial draft report structure
                    const tabsData: Record<string, ProgressReportTabState> = {};

                    allTabs.forEach(tab => {
                        const headerName = tab.project_work_header_name;
                        if (headerName === 'Work force') {
                            tabsData[headerName] = {
                                manpower_remarks: '',
                                manpower: inheritedManpower || getManpowerRolesDefault(), // Use inherited or default
                                milestones: [],
                                is_manpower_updated: false,
                                is_milestones_updated: false,
                            };
                        } else {
                            // Filter and assign inherited milestones to the respective tab
                            const headerMilestones = allInheritedMilestones
                                .filter(m => m.work_header === headerName)
                                .map(m => ({
                                    ...m,
                                    history: m.history || [], // Ensure history array exists
                                    is_updated: false, // Reset updated flag
                                }));

                            tabsData[headerName] = {
                                manpower_remarks: '',
                                manpower: [],
                                milestones: headerMilestones,
                                is_manpower_updated: false,
                                is_milestones_updated: false,
                            };
                        }
                    });

                    set({
                        draftReport: {
                            project: projectId,
                            report_date: reportDate,
                            report_status: 'Draft',
                            frappe_doc_name: previousFrappeDocName,
                            tabs_data: tabsData,
                        },
                    });
                },

                updateManpowerData: (manpower, remarks) => set(state => {
                    if (!state.draftReport) return state;

                    // Manually create new objects for immutable update
                    const updatedTabsData = {
                        ...state.draftReport.tabs_data,
                        'Work force': {
                            ...state.draftReport.tabs_data['Work force'], // Corrected typo: `state.draftReport.tabs_force` should be `state.draftReport.tabs_data`
                            manpower: [...manpower], // Create a new array
                            manpower_remarks: remarks,
                            is_manpower_updated: true,
                        },
                    };

                    return {
                        draftReport: {
                            ...state.draftReport,
                            tabs_data: updatedTabsData,
                        },
                    };
                }),

                updateMilestone: (workHeader, updatedMilestone) => set(state => {
                    if (!state.draftReport) return state;

                    const headerData = state.draftReport.tabs_data[workHeader];
                    if (!headerData) return state;

                    const updatedMilestones = headerData.milestones.map(m => {
                        if (m.name === updatedMilestone.name) {
                            const newHistoryEntry: MilestoneHistoryEntry = {
                                date: state.draftReport!.report_date,
                                previous_status: m.status,
                                previous_start_date: m.expected_starting_date,
                                previous_completion_date: m.expected_completion_date,
                                previous_remarks: m.remarks,
                            };

                            const hasChanged = m.status !== updatedMilestone.status ||
                                m.progress !== updatedMilestone.progress ||
                                m.expected_starting_date !== updatedMilestone.expected_starting_date ||
                                m.expected_completion_date !== updatedMilestone.expected_completion_date ||
                                m.remarks !== updatedMilestone.remarks;

                            return {
                                ...updatedMilestone,
                                // history: hasChanged ? [...m.history, newHistoryEntry] : m.history, // Create a new history array
                                is_updated: true,
                            };
                        }
                        return m;
                    });

                    // Manually create new objects for immutable update
                    const updatedTabsData = {
                        ...state.draftReport.tabs_data,
                        [workHeader]: {
                            ...headerData,
                            milestones: updatedMilestones, // Use the new milestones array
                            is_milestones_updated: true,
                        },
                    };

                    return {
                        draftReport: {
                            ...state.draftReport,
                            tabs_data: updatedTabsData,
                        },
                    };
                }),

                clearDraft: () => set({ draftReport: null }),

                setFrappeDocName: (docName) => set(state => {
                    if (!state.draftReport) return state;
                    return {
                        draftReport: {
                            ...state.draftReport,
                            frappe_doc_name: docName,
                        },
                    };
                }),

                getMilestonesForHeader: (workHeader) => {
                    const report = get().draftReport;
                    if (!report || workHeader === 'Work force') return [];
                    return report.tabs_data[workHeader]?.milestones || [];
                },
            }),
            {
                name: 'project-progress-report-storage', // Key for local storage
                partialize: (state) => ({ draftReport: state.draftReport }), // Only persist the draft report data
                version: 1, // Version for migrations if your state structure changes later
            }
        )
    )
);