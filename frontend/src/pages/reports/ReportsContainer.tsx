import { useStateSyncedWithParams } from '@/hooks/useSearchParamsManager';
import React, { Suspense, useCallback, useEffect, useMemo } from "react";
import { useUserData } from "@/hooks/useUserData";
import { Radio } from "antd";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { REPORTS_TABS } from './constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { POReportType, ProjectReportType, ReportType, useReportStore } from './store/useReportStore';

const ProjectReports = React.lazy(() => import('./components/ProjectReports'));
const POReports = React.lazy(() => import('./components/POReports'));


// Define options for the selector
const projectReportOptions: { label: string; value: ProjectReportType }[] = [
    { label: 'Cash Sheet', value: 'Cash Sheet' },
];

const poReportOptions: { label: string; value: POReportType }[] = [
    { label: 'Pending Invoices', value: 'Pending Invoices' },
    { label: 'PO with Excess Payments', value: 'PO with Excess Payments' },
];

export default function ReportsContainer() {

    const { role } = useUserData();
    const [activeTab, setActiveTab] = useStateSyncedWithParams<string>(
        "tab",
        REPORTS_TABS.PROJECTS
    );


    // Get state and actions from Zustand store
    const selectedReportType = useReportStore((state) => state.selectedReportType);
    const setSelectedReportType = useReportStore((state) => state.setSelectedReportType);
    const setDefaultReportType = useReportStore((state) => state.setDefaultReportType);

    // Update default report type when tab changes
    useEffect(() => {
        setDefaultReportType(activeTab);
    }, [activeTab, setDefaultReportType]);

    const tabs = useMemo(() => [
        // ...(["Nirmaan Admin Profile", "Nirmaan Accountant Profile"].includes(role) ? [
        {
            label: (
                <div className="flex items-center">
                    <span>Projects</span>
                </div>
            ),
            value: REPORTS_TABS.PROJECTS,
        },
        // ] : []),
        {
            label: (
                <div className="flex items-center">
                    <span>PO</span>
                </div>
            ),
            value: REPORTS_TABS.PO,
        },
    ], [role])

    const onClick = useCallback(
        (value: string) => {
            if (activeTab === value) return; // Prevent redundant updates

            setActiveTab(value);
        }, [activeTab, setActiveTab]);


    const currentReportOptions = useMemo(() => {
        if (activeTab === REPORTS_TABS.PROJECTS) {
            return projectReportOptions;
        } else if (activeTab === REPORTS_TABS.PO) {
            return poReportOptions;
        }
        return [];
    }, [activeTab]);

    const handleReportTypeChange = (value: ReportType) => {
        setSelectedReportType(value);
    };


    return (
        <div
            className="flex-1 space-y-4"
        >

            <div className="flex justify-between items-center gap-4 flex-wrap">
                {tabs && (
                    <Radio.Group
                        options={tabs}
                        defaultValue="projects"
                        optionType="button"
                        buttonStyle="solid"
                        value={activeTab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}

                {/* Report Type Selector */}
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">Report Type:</span>
                    {/* Example using Ant Design Select */}
                    {/* <AntSelect
                         style={{ width: 200 }}
                         value={selectedReportType}
                         onChange={handleReportTypeChange}
                         options={currentReportOptions}
                         disabled={currentReportOptions.length === 0}
                     /> */}

                    {/* --- OR --- Example using Shadcn UI Select */}
                    <Select
                        value={selectedReportType ?? ""} // Handle null value if needed
                        onValueChange={(value: string) => handleReportTypeChange(value as ReportType)} // Cast necessary
                        disabled={currentReportOptions.length === 0}
                    >
                        <SelectTrigger className="w-[200px] text-red-600 border-red-600">
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
            </div>

            {/* Content Area */}
            <Suspense fallback={<LoadingFallback />}>
                {activeTab === REPORTS_TABS.PROJECTS ? (
                    <ProjectReports />
                ) : activeTab === REPORTS_TABS.PO ? (
                    <POReports />
                ) : (
                    <div>Select a report tab.</div> // Fallback for invalid tab
                )}
            </Suspense>

        </div>
    );
}