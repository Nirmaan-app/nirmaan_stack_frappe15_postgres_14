import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useUserData } from "@/hooks/useUserData";
import { Radio } from "antd";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { REPORTS_TABS } from './constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { POReportOption, SROption, ProjectReportType, ReportType, useReportStore, VendorReportType } from './store/useReportStore';
import { getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';

// Lazy load report components
const ProjectReports = React.lazy(() => import('./components/ProjectReports'));
const POReports = React.lazy(() => import('./components/POReports'));
const SRReports = React.lazy(() => import('./components/SRReports'));
const VendorReports = React.lazy(() => import('./components/VendorReports'));

// Define options for the selector
const projectReportOptions: { label: string; value: ProjectReportType }[] = [
    { label: 'Cash Sheet', value: 'Cash Sheet' },
    { label: 'Inflow Report', value: 'Inflow Report' },
    { label: 'Outflow Report(Project)', value: 'Outflow Report(Project)' },
    { label: 'Outflow Report(Non-Project)', value: 'Outflow Report(Non-Project)' },
    { label: 'Project Progress Report', value: 'Project Progress Report' }
];
const VendorReportOptions: { label: string; value: VendorReportType }[] = [{
    label: 'Vendor Ledger', value: 'Vendor Ledger'
}];

const poReportOptions: { label: string; value: POReportOption }[] = [
    { label: 'Pending Invoices', value: 'Pending Invoices' },
    { label: 'PO with Excess Payments', value: 'PO with Excess Payments' },
    { label: 'Dispatched for 1+ days', value: 'Dispatched for 1 days' },
];

const srReportOptions: { label: string; value: SROption }[] = [
    { label: 'Pending Invoices', value: 'Pending Invoices' },
    { label: 'Excess Payments (WO)', value: 'PO with Excess Payments' },
];

export default function ReportsContainer() {
    const { role } = useUserData(); // Get current user's role
    const selectedReportType = useReportStore((state) => state.selectedReportType);
    const setSelectedReportType = useReportStore((state) => state.setSelectedReportType);
    const setDefaultReportType = useReportStore((state) => state.setDefaultReportType);

    // Determine initial active tab based on role and URL param
    const initialTab = useMemo(() => {
        const urlTab = getUrlStringParam("tab", null);
        if (role === "Nirmaan Project Manager Profile") {
            // PM can only see PO and SR. If URL tab is something else or null, default to PO.
            if (urlTab === REPORTS_TABS.PO || urlTab === REPORTS_TABS.SR) return urlTab;
            return REPORTS_TABS.PO;
        }
        // Admin/Accountant default to Projects if no valid URL tab or if URL tab is Projects
        if (urlTab === REPORTS_TABS.PROJECTS || urlTab === REPORTS_TABS.VENDORS || urlTab === REPORTS_TABS.PO || urlTab === REPORTS_TABS.SR) return urlTab;
        return REPORTS_TABS.PROJECTS; // Default for Admin/Accountant
    }, [role]);





    const [activeTab, setActiveTab] = useState<string>(initialTab);

    // --- THIS IS THE FIX ---
    // The dependency array is corrected to prevent the infinite loop.
    // This effect's job is to sync the URL to the state, not to react to its own state changes.
    useEffect(() => {
        const urlTab = getUrlStringParam("tab", null);
        const urlReport = getUrlStringParam("report", null) as ReportType;

        // Sync Tab from URL
        if (urlTab && urlTab !== activeTab) {
            setActiveTab(urlTab);
        }

        // Sync Report Type from URL
        if (urlReport) {
            // No need to check against selectedReportType here, just set it.
            // This simplifies the logic and prevents cycles.
            setSelectedReportType(urlReport);
        } else {
            // If no report in URL, set the default for the current context.
            setDefaultReportType(activeTab, role);
        }

        // Subscribe to browser back/forward navigation
        const sub1 = urlStateManager.subscribe("tab", (_, v) => setActiveTab(v || initialTab));
        const sub2 = urlStateManager.subscribe("report", (_, v) => {
            if (!v) {
                setDefaultReportType(activeTab, role);
            } else {
                setSelectedReportType(v as ReportType);
            }
        });

        return () => {
            sub1();
            sub2();
        };
        // The dependency array is now stable and won't cause loops.
    }, [activeTab, role, initialTab, setDefaultReportType, setSelectedReportType]);

    const handleTabClick = useCallback((value: string) => {
        if (activeTab !== value) {
            // When user clicks a tab, update the URL. The effects above will handle state changes.
            // Clear report and filter params to ensure a clean state for the new tab.
            urlStateManager.updateParam("tab", value);
            urlStateManager.updateParam("report", null);
            // This is important: Clear the filters specific to the inflow table.
            urlStateManager.updateParam("inflow_report_table_filters", null);
            urlStateManager.updateParam("outflow_report_table_filters", null); // Also clear outflow filters
        }
    }, [activeTab]);

    const handleReportTypeChange = (value: string) => {
        const validReportType = currentReportOptions.find(opt => opt.value === value)?.value as ReportType;
        if (validReportType && validReportType !== selectedReportType) {
            // When user selects a report, update the URL. State changes will follow.
            urlStateManager.updateParam("report", validReportType);
            urlStateManager.updateParam("inflow_report_table_filters", null); // Clear filters when changing report
            urlStateManager.updateParam("outflow_report_table_filters", null);
        }
    };


    // Define available tabs based on role
    const tabs = useMemo(() => {
        const availableTabs = [];
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>Projects</span></div>,
                value: REPORTS_TABS.PROJECTS,
            });
        }
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>Vendors</span></div>,
                value: REPORTS_TABS.VENDORS,
            });
        }
        //
        // All three roles (Admin, Accountant, PM) can see PO and SR tabs
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>PO</span></div>,
                value: REPORTS_TABS.PO,
            });
        }
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>WO</span></div>,
                value: REPORTS_TABS.SR,
            });
        }
        return availableTabs;
    }, [role]);

    // If the current activeTab is not in the list of available tabs for the role,
    // reset activeTab to the first available tab (or a sensible default).
    useEffect(() => {
        if (tabs.length > 0 && !tabs.find(t => t.value === activeTab)) {
            setActiveTab(tabs[0].value);
        } else if (tabs.length === 0 && activeTab !== '') { // No tabs available, clear activeTab
            setActiveTab(''); // Or a placeholder value like 'no_access'
        }
    }, [tabs, activeTab]);





    const currentReportOptions = useMemo(() => {
        if (activeTab === REPORTS_TABS.PROJECTS) {
            return ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(role)
                ? projectReportOptions
                : [];
        } else if (activeTab === REPORTS_TABS.VENDORS) {
            return ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(role)
                ? VendorReportOptions
                : [];
        } else if (activeTab === REPORTS_TABS.PO) {
            return role === "Nirmaan Project Manager Profile"
                ? poReportOptions.filter(option => option.value === 'Dispatched for 1 days')
                : (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role) ? poReportOptions : []);
        } else if (activeTab === REPORTS_TABS.SR) {
            return ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
                ? srReportOptions
                : [];
        }
        return [];
    }, [activeTab, role]);


    // Effect to auto-select/validate report type when options change
    useEffect(() => {
        // console.log("Current Report Options changed:", currentReportOptions);
        // console.log("Current Selected Report Type:", selectedReportType);
        if (currentReportOptions.length === 1) {
            const onlyOptionValue = currentReportOptions[0].value;
            if (selectedReportType !== onlyOptionValue) {
                // console.log("Auto-selecting only available option:", onlyOptionValue);
                setSelectedReportType(onlyOptionValue as ReportType);
            }
        } else if (selectedReportType && !currentReportOptions.some(opt => opt.value === selectedReportType)) {
            // If current selection is no longer valid, reset to default for the current tab/role
            // console.log("Current selection invalid, resetting to default for tab:", activeTab, "role:", role);
            setDefaultReportType(activeTab, role);
        } else if (!selectedReportType && currentReportOptions.length > 0) {
            // If no report is selected but there are options, set to default
            // This happens on initial load or if selection became null
            // console.log("No report selected but options exist, setting to default for tab:", activeTab, "role:", role);
            setDefaultReportType(activeTab, role);
        }

    }, [currentReportOptions, selectedReportType, setSelectedReportType, setDefaultReportType, activeTab, role]);


    const renderRadioGroup = () => {
        if (!tabs.length) {
            return <div className="text-sm text-gray-600 p-4">No reports accessible for your current role.</div>;
        }
        return (
            <Radio.Group
                options={tabs}
                optionType="button"
                buttonStyle="solid"
                value={activeTab} // Controlled by activeTab state
                onChange={(e) => handleTabClick(e.target.value)}
            />
        );
    };

    const renderReportContent = () => {
        if (!tabs.find(t => t.value === activeTab)) { // If activeTab is not valid for current role
            return <div className="p-4 text-center text-gray-500">Please select an available report tab.</div>;
        }
        if (activeTab === REPORTS_TABS.PROJECTS) return <ProjectReports />;
        if (activeTab === REPORTS_TABS.VENDORS) return <VendorReports />; // 👈 ADD THIS
        if (activeTab === REPORTS_TABS.PO) return <POReports />;
        if (activeTab === REPORTS_TABS.SR) return <SRReports />;
        return <div className="p-4 text-center text-gray-500">Select a report tab to view details.</div>;
    };


    return (
        <div className="flex-1 space-y-4">
            <div className="flex justify-between items-center gap-4 flex-wrap">
                {renderRadioGroup()}

                {currentReportOptions.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">Report Type:</span>
                        <Select
                            value={selectedReportType ?? ""} // Ensure value is not null for Select
                            onValueChange={handleReportTypeChange}
                            disabled={currentReportOptions.length <= 1 && selectedReportType !== null} // Disable if only one option and it's selected
                        >
                            <SelectTrigger className="w-[250px] text-red-600 border-red-600">
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {currentReportOptions.map(option => (
                                    <SelectItem className='text-red-600' key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            <Suspense fallback={<LoadingFallback />}>
                {renderReportContent()}
            </Suspense>
        </div>
    );
}