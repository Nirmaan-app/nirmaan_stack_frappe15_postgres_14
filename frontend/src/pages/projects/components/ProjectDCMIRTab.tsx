import { useMemo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDCMIRReportsData } from "../../reports/hooks/useDCMIRReportsData";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import DCMIRReports from "../../reports/components/DCMIRReports";
import DNDCQuantityReport from "../../reports/components/DNDCQuantityReport";

interface ProjectDCMIRTabProps {
    projectId: string;
    projectName?: string;
}

type TabType = 'DN_DC' | 'DC' | 'MIR';

export const ProjectDCMIRTab: React.FC<ProjectDCMIRTabProps> = ({ projectId, projectName }) => {
    // --- State ---
    const initialTab = (getUrlStringParam("dcmir_tab", "DN_DC") as TabType) || "DN_DC";
    const [activeTab, setActiveTab] = useState<TabType>(initialTab);

    // Sync tab to URL
    useEffect(() => {
        urlStateManager.updateParam("dcmir_tab", activeTab);
    }, [activeTab]);

    // --- Data Fetching (Only for counts) ---
    const { reportData: allDeliveryDocs, isLoading: isLoadingInitialData, error: initialDataError } = useDCMIRReportsData();

    // --- Derived Data (Counts) ---
    const projectDocs = useMemo(() => {
        if (!allDeliveryDocs) return [];
        return allDeliveryDocs.filter(doc => doc.project === projectId);
    }, [allDeliveryDocs, projectId]);

    const dcCount = projectDocs.filter(d => d.type === 'Delivery Challan').length;
    const mirCount = projectDocs.filter(d => d.type === 'Material Inspection Report').length;

    if (initialDataError) {
        return <AlertDestructive error={initialDataError as Error} />;
    }

    if (isLoadingInitialData && !allDeliveryDocs) {
        return <LoadingFallback />;
    }

    return (
        <div className="flex-1 space-y-4">
            {/* Custom Tab Switcher */}
            <div className="flex items-center gap-2 border-b pb-2 mb-2">
                <button
                    onClick={() => setActiveTab('DN_DC')}
                    className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2 whitespace-nowrap",
                        activeTab === 'DN_DC'
                            ? "bg-sky-500 text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-sky-500 hover:text-white"
                    )}
                >
                    <span>DN &gt; DC Report</span>
                </button>
                <button
                    onClick={() => setActiveTab('DC')}
                    className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2 whitespace-nowrap",
                        activeTab === 'DC'
                            ? "bg-sky-500 text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-sky-500 hover:text-white"
                    )}
                >
                    <span>DC</span>
                    <span className={cn(
                        "flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[10px] font-bold",
                        activeTab === 'DC'
                            ? "bg-white text-sky-600"
                            : "bg-white text-slate-600"
                    )}>
                        {dcCount}
                    </span>
                </button>
                <button
                    onClick={() => setActiveTab('MIR')}
                    className={cn(
                        "px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2 whitespace-nowrap",
                        activeTab === 'MIR'
                            ? "bg-sky-500 text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-sky-500 hover:text-white"
                    )}
                >
                    <span>MIR</span>
                    <span className={cn(
                        "flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[10px] font-bold",
                        activeTab === 'MIR'
                            ? "bg-white text-sky-600"
                            : "bg-white text-slate-600"
                    )}>
                        {mirCount}
                    </span>
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'DN_DC' ? (
                    <DNDCQuantityReport
                        projectId={projectId}
                        projectName={projectName}
                    />
                ) : (
                    <DCMIRReports
                        projectId={projectId}
                        forcedReportType={activeTab === 'DC' ? 'DC Report' : 'MIR Report'}
                    />
                )}
            </div>
        </div>
    );
};
