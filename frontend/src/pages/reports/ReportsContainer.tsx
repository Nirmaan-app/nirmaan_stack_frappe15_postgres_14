import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useUserData } from "@/hooks/useUserData";
import { Radio } from "antd";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { REPORTS_TABS } from './constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { POReportOption, SROption, ProjectReportType, ReportType, useReportStore } from './store/useReportStore';
import { getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';

// Lazy load report components
const ProjectReports = React.lazy(() => import('./components/ProjectReports'));
const POReports = React.lazy(() => import('./components/POReports'));
const SRReports = React.lazy(() => import('./components/SRReports'));

// Define options for the selector
const projectReportOptions: { label: string; value: ProjectReportType }[] = [
    { label: 'Cash Sheet', value: 'Cash Sheet' },
];

const poReportOptions: { label: string; value: POReportOption }[] = [
    { label: 'Pending Invoices', value: 'Pending Invoices' },
    { label: 'PO with Excess Payments', value: 'PO with Excess Payments' },
    { label: 'Dispatched for 3+ days', value: 'Dispatched for 3 days' },
];

const srReportOptions: { label: string; value: SROption }[] = [
    { label: 'Pending Invoices', value: 'Pending Invoices' },
    { label: 'Excess Payments (SR)', value: 'PO with Excess Payments' },
];

export default function ReportsContainer() {
    const { role } = useUserData(); // Get current user's role

    // Determine initial active tab based on role and URL param
    const initialTab = useMemo(() => {
        const urlTab = getUrlStringParam("tab", null);
        if (role === "Nirmaan Project Manager Profile") {
            // PM can only see PO and SR. If URL tab is something else or null, default to PO.
            if (urlTab === REPORTS_TABS.PO || urlTab === REPORTS_TABS.SR) return urlTab;
            return REPORTS_TABS.PO;
        }
        // Admin/Accountant default to Projects if no valid URL tab or if URL tab is Projects
        if (urlTab === REPORTS_TABS.PROJECTS || urlTab === REPORTS_TABS.PO || urlTab === REPORTS_TABS.SR) return urlTab;
        return REPORTS_TABS.PROJECTS;
    }, [role]);

    const [activeTab, setActiveTab] = useState<string>(initialTab);

    // Sync tab state TO URL
    useEffect(() => {
        if (urlStateManager.getParam("tab") !== activeTab) {
            urlStateManager.updateParam("tab", activeTab);
        }
    }, [activeTab]);

    // Sync URL TO tab state (for popstate/direct URL load)
    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            const newUrlTab = value || initialTab; // Fallback to initial if param removed
            if (activeTab !== newUrlTab) {
                setActiveTab(newUrlTab);
            }
        });
        return unsubscribe;
    }, [initialTab, activeTab]);


    const selectedReportType = useReportStore((state) => state.selectedReportType);
    const setSelectedReportType = useReportStore((state) => state.setSelectedReportType);
    const setDefaultReportType = useReportStore((state) => state.setDefaultReportType);

    // Set default report type when tab or role changes
    useEffect(() => {
        // console.log(`Container: Tab changed to ${activeTab}, Role: ${role}. Setting default report type.`);
        setDefaultReportType(activeTab, role);
    }, [activeTab, role, setDefaultReportType]);


    // Define available tabs based on role
    const tabs = useMemo(() => {
        const availableTabs = [];
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>Projects</span></div>,
                value: REPORTS_TABS.PROJECTS,
            });
        }
        // All three roles (Admin, Accountant, PM) can see PO and SR tabs
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>PO</span></div>,
                value: REPORTS_TABS.PO,
            });
        }
        if (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)) {
            availableTabs.push({
                label: <div className="flex items-center"><span>SR</span></div>,
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


    const handleTabClick = useCallback((value: string) => {
        if (activeTab !== value) {
            setActiveTab(value);
        }
    }, [activeTab]);


    const currentReportOptions = useMemo(() => {
        if (activeTab === REPORTS_TABS.PROJECTS) {
            return ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Project Lead Profile"].includes(role)
                ? projectReportOptions
                : [];
        } else if (activeTab === REPORTS_TABS.PO) {
            return role === "Nirmaan Project Manager Profile"
                ? poReportOptions.filter(option => option.value === 'Dispatched for 3 days')
                : (["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role) ? poReportOptions : []);
        } else if (activeTab === REPORTS_TABS.SR) {
            return ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
                ? srReportOptions
                : [];
        }
        return [];
    }, [activeTab, role]);


    const handleReportTypeChange = (value: string) => {
        const validReportType = currentReportOptions.find(opt => opt.value === value)?.value;
        setSelectedReportType(validReportType ? validReportType as ReportType : null);
    };

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