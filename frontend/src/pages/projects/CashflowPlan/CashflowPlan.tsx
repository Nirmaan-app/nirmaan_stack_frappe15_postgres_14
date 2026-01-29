import React, { useMemo } from "react";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { startOfDay, addDays, parseISO, format } from "date-fns";
import { DateRange } from "react-day-picker";
import { SevenDayPlanningHeader } from "../components/planning/SevenDayPlanningHeader";
import { CashflowTabs, CASHFLOW_TABS, CashflowTabValue, CASHFLOW_TAB_CONFIG } from "./CashflowTabs";
import { POCashflow } from "./POCashflow";
import { WOCashflow } from "./WOCashflow";
import { MiscCashflow } from "./MiscCashflow";
import { InflowCashflow } from "./InflowCashflow";
import { useToast } from "@/components/ui/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CashflowPlanProps {
    projectId?: string;
    isOverview?: boolean;
}

import { useFrappeGetDoc } from "frappe-react-sdk";

export const CashflowPlan = ({ projectId, isOverview }: CashflowPlanProps) => {
    // --- State & Hooks ---
    const tabParam = useUrlParam("tab");
    const { toast } = useToast();
    const [isDownloading, setIsDownloading] = React.useState(false);
    const [isDownloadingAll, setIsDownloadingAll] = React.useState(false);
    const [downloadingTab, setDownloadingTab] = React.useState<CashflowTabValue | null>(null);

    const { data: projectDoc } = useFrappeGetDoc("Projects", projectId);
    
    // --- Tabs Logic ---
    const activeTab = useMemo(() => {
        if (Object.values(CASHFLOW_TABS).includes(tabParam as any)) {
            return tabParam as CashflowTabValue;
        }
        return CASHFLOW_TABS.PO_CASHFLOW;
    }, [tabParam]);

    const handleTabChange = (tab: CashflowTabValue) => {
        urlStateManager.updateParam("tab", tab);
    };

    // --- Date/Duration Logic ---
    const activeDurationParam = useUrlParam("planningDuration");
    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const activeDuration = useMemo(() => {
        if (activeDurationParam === "All") return "All";
        const num = Number(activeDurationParam);
        if (!isNaN(num) && [3, 7, 14].includes(num)) return num;
        if (activeDurationParam === "custom") return "custom";
        return "All"; 
    }, [activeDurationParam]);

    const dateRange = useMemo<DateRange | undefined>(() => {
        const today = startOfDay(new Date());
        if (activeDuration === "All") return undefined;
        if (typeof activeDuration === 'number') {
             return { from: today, to: addDays(today, activeDuration) };
        }
        if (activeDuration === 'custom' && startDateParam && endDateParam) {
            return { from: parseISO(startDateParam), to: parseISO(endDateParam) };
        }
        return undefined;
    }, [activeDuration, startDateParam, endDateParam]);

    const setDaysRange = (days: number | "All" | "custom", customRange?: DateRange) => {
        urlStateManager.updateParam("planningDuration", days.toString());
        if (days === "custom" && customRange?.from && customRange?.to) {
            urlStateManager.updateParam("startDate", format(customRange.from, 'yyyy-MM-dd'));
            urlStateManager.updateParam("endDate", format(customRange.to, 'yyyy-MM-dd'));
        } else {
            urlStateManager.updateParam("startDate", null);
            urlStateManager.updateParam("endDate", null);
        }
    };

    // --- Download Handlers ---
    const handleDownload = async (type: "current" | "all" | CashflowTabValue) => {
        if (!projectId) {
            toast({ title: "Error", description: "Project ID missing.", variant: "destructive" });
            return;
        }

        const isAll = type === "all";
        const isCurrent = type === "current";
        
        // Determine which specific tab we are downloading (if not 'all')
        // If type is 'current', use activeTab. If type is a specific tab value, use that.
        const targetTab = isCurrent ? activeTab : (isAll ? undefined : type);

        // Set loading state
        if (isAll) setIsDownloadingAll(true);
        else if (isCurrent) setIsDownloading(true);
        else if (targetTab) setDownloadingTab(targetTab);

        try {
            const queryParams = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: "Project Cashflow Plan",
                no_letterhead: "0",
            });
            
            if (!isAll && targetTab) queryParams.append("cashflow_type", targetTab);

            if (dateRange?.from && dateRange?.to) {
                queryParams.append("start_date", format(dateRange.from, 'yyyy-MM-dd'));
                queryParams.append("end_date", format(dateRange.to, 'yyyy-MM-dd'));
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${queryParams.toString()}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network error");
        
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            
            // Prefer project_name if available, else projectId
            const nameToUse = projectDoc?.project_name || projectId;
            const safeProjectName = nameToUse.replace(/ /g, "_");
            const prefix = isAll ? "All_Cashflow" : (targetTab || activeTab).replace(/ /g, "_").replace(/\./g, "");
            const dateStr = format(new Date(), "dd-MMM-yyyy");
            
            link.download = `${prefix}_${safeProjectName}_${dateStr}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);

            toast({ title: "Completed", description: "Report downloaded successfully." });
        } catch (error) {
            console.error("Download failed:", error);
            toast({ title: "Failed", description: "Could not download report.", variant: "destructive" });
        } finally {
            if (isAll) setIsDownloadingAll(false);
            else if (isCurrent) setIsDownloading(false);
            else setDownloadingTab(null);
        }
    };

    // --- Render ---
    return (
        <div className="flex flex-col h-full bg-gray-50/50">
            {/* 1. Command Center Header */}
            <SevenDayPlanningHeader 
                title={projectId} 
                activeDuration={activeDuration}
                dateRange={dateRange}
                setDaysRange={setDaysRange}
            />

            {/* 2. Navigation Tabs (Dense) */}
            <div className="sticky top-0 z-10 bg-white shadow-sm">
                <CashflowTabs 
                    activeTab={activeTab} 
                    onTabChange={handleTabChange}
                    // TODO: Wire up actual counts from react-query data in Phase 2
                    rightElement={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                 <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="h-8 gap-2 px-3 bg-white text-gray-700 border-gray-200 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-all font-medium"
                                >
                                    <Download className="w-3.5 h-3.5 text-gray-500" />
                                    <span className="text-xs">Export</span>
                                    <ChevronDown className="w-3 h-3 text-gray-400 opacity-50" />
                                 </Button>
                            </DropdownMenuTrigger>
                            {/* Dropdown width matches button on desktop, full-ish on mobile */}
                            <DropdownMenuContent align="end" className="w-56 md:w-32">
                                <DropdownMenuLabel className="text-[10px] uppercase text-gray-500">PDF Reports</DropdownMenuLabel>
                                
                                <DropdownMenuItem onClick={() => handleDownload("current")} disabled={isDownloading}>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs font-medium">Export {activeTab}</span>
                                        <span className="text-[10px] text-gray-500">Current view only</span>
                                    </div>
                                    {isDownloading && <span className="ml-auto text-xs animate-pulse">...</span>}
                                </DropdownMenuItem>
                                
                                <DropdownMenuSeparator />

                                <DropdownMenuItem onClick={() => handleDownload("all")} disabled={isDownloadingAll}>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs font-medium">Complete Report</span>
                                        <span className="text-[10px] text-gray-500">All Modules</span>
                                    </div>
                                    {isDownloadingAll && <span className="ml-auto text-xs animate-pulse">...</span>}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                />
            </div>

            {/* 3. Scrollable Content Area */}
            <ScrollArea className="flex-1">
                <div className="p-2">
                    {activeTab === CASHFLOW_TABS.PO_CASHFLOW && <POCashflow dateRange={dateRange} isOverview={isOverview} />}
                    {activeTab === CASHFLOW_TABS.WO_CASHFLOW && <WOCashflow dateRange={dateRange} isOverview={isOverview} />}
                    {activeTab === CASHFLOW_TABS.MISC_CASHFLOW && <MiscCashflow dateRange={dateRange} isOverview={isOverview} />}
                    {activeTab === CASHFLOW_TABS.INFLOW && <InflowCashflow dateRange={dateRange} isOverview={isOverview} />}
                </div>
            </ScrollArea>
        </div>
    );
};
