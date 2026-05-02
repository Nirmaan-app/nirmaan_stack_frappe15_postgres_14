import { useMemo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDCMIRReportsData } from "../../reports/hooks/useDCMIRReportsData";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import DCMIRReports from "../../reports/components/DCMIRReports";
import DNDCQuantityReport from "../../reports/components/DNDCQuantityReport";
import ITMDNDCQuantityReport from "../../reports/components/ITMDNDCQuantityReport";

interface ProjectDCMIRTabProps {
    projectId: string;
    projectName?: string;
}

type TabType = 'DN_DC' | 'DC' | 'MIR';
type ParentType = 'PO' | 'ITM';

const PARENT_DOCTYPE: Record<ParentType, 'Procurement Orders' | 'Internal Transfer Memo'> = {
    PO: 'Procurement Orders',
    ITM: 'Internal Transfer Memo',
};

export const ProjectDCMIRTab: React.FC<ProjectDCMIRTabProps> = ({ projectId, projectName }) => {
    // --- State ---
    const initialTab = (getUrlStringParam("dcmir_tab", "DN_DC") as TabType) || "DN_DC";
    const initialParent = (getUrlStringParam("dcmir_parent", "PO") as ParentType) || "PO";
    const [activeTab, setActiveTab] = useState<TabType>(initialTab);
    const [parent, setParent] = useState<ParentType>(initialParent);

    // Sync state to URL
    useEffect(() => {
        urlStateManager.updateParam("dcmir_tab", activeTab);
    }, [activeTab]);
    useEffect(() => {
        urlStateManager.updateParam("dcmir_parent", parent);
    }, [parent]);

    // --- Data Fetching (Only for counts) ---
    const { reportData: allDeliveryDocs, isLoading: isLoadingInitialData, error: initialDataError } = useDCMIRReportsData();

    // --- Derived Data (Counts split by parent type) ---
    const projectDocs = useMemo(() => {
        if (!allDeliveryDocs) return [];
        return allDeliveryDocs.filter(doc => doc.project === projectId);
    }, [allDeliveryDocs, projectId]);

    const dcCountByParent = useMemo(() => {
        const out = { PO: 0, ITM: 0 };
        for (const d of projectDocs) {
            if (d.type !== 'Delivery Challan') continue;
            if (d.parent_doctype === 'Internal Transfer Memo') out.ITM++;
            else out.PO++;
        }
        return out;
    }, [projectDocs]);

    const mirCountByParent = useMemo(() => {
        const out = { PO: 0, ITM: 0 };
        for (const d of projectDocs) {
            if (d.type !== 'Material Inspection Report') continue;
            if (d.parent_doctype === 'Internal Transfer Memo') out.ITM++;
            else out.PO++;
        }
        return out;
    }, [projectDocs]);

    const dcCount = dcCountByParent.PO + dcCountByParent.ITM;
    const mirCount = mirCountByParent.PO + mirCountByParent.ITM;

    if (initialDataError) {
        return <AlertDestructive error={initialDataError as Error} />;
    }

    if (isLoadingInitialData && !allDeliveryDocs) {
        return <LoadingFallback />;
    }

    return (
        <div className="flex-1 space-y-4">
            {/* Custom Tab Switcher (outer) */}
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

            {/* Inner PO / ITM segmented toggle */}
            <div className="flex items-center gap-3 mb-3">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Source
                </span>
                <div className="inline-flex items-center bg-muted rounded-lg p-1 gap-1">
                    <button
                        onClick={() => setParent('PO')}
                        className={cn(
                            "relative inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all",
                            parent === 'PO'
                                ? "bg-red-600 text-white shadow-sm"
                                : "text-foreground hover:text-black"
                        )}
                    >
                        <span>Purchase Orders</span>
                        {activeTab === 'DC' && (
                            <span className={cn(
                                "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold",
                                parent === 'PO' ? "bg-white text-red-600" : "bg-muted-foreground/10 text-muted-foreground"
                            )}>
                                {dcCountByParent.PO}
                            </span>
                        )}
                        {activeTab === 'MIR' && (
                            <span className={cn(
                                "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold",
                                parent === 'PO' ? "bg-white text-red-600" : "bg-muted-foreground/10 text-muted-foreground"
                            )}>
                                {mirCountByParent.PO}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setParent('ITM')}
                        className={cn(
                            "relative inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all",
                            parent === 'ITM'
                                ? "bg-red-600 text-white shadow-sm"
                                : "text-foreground hover:text-black"
                        )}
                    >
                        <span>Transfer Memos</span>
                        {activeTab === 'DC' && (
                            <span className={cn(
                                "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold",
                                parent === 'ITM' ? "bg-white text-red-600" : "bg-muted-foreground/10 text-muted-foreground"
                            )}>
                                {dcCountByParent.ITM}
                            </span>
                        )}
                        {activeTab === 'MIR' && (
                            <span className={cn(
                                "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold",
                                parent === 'ITM' ? "bg-white text-red-600" : "bg-muted-foreground/10 text-muted-foreground"
                            )}>
                                {mirCountByParent.ITM}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'DN_DC' ? (
                    parent === 'PO' ? (
                        <DNDCQuantityReport
                            projectId={projectId}
                            projectName={projectName}
                        />
                    ) : (
                        <ITMDNDCQuantityReport
                            projectId={projectId}
                            projectName={projectName}
                        />
                    )
                ) : (
                    <DCMIRReports
                        projectId={projectId}
                        forcedReportType={activeTab === 'DC' ? 'DC Report' : 'MIR Report'}
                        parentDoctype={PARENT_DOCTYPE[parent]}
                    />
                )}
            </div>
        </div>
    );
};
