import React, { useMemo } from "react";
import { useUrlParam } from "@/hooks/useUrlParam";
import { urlStateManager } from "@/utils/urlStateManager";
import { startOfDay, addDays, parseISO, format } from "date-fns";
import { DateRange } from "react-day-picker";
import { SevenDayPlanningHeader } from "../components/planning/SevenDayPlanningHeader";
import { CashflowTabs, CASHFLOW_TABS, CashflowTabValue } from "./CashflowTabs";
import { POCashflow } from "./POCashflow";
import { WOCashflow } from "./WOCashflow";
import { MiscCashflow } from "./MiscCashflow";
import { InflowCashflow } from "./InflowCashflow";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface CashflowPlanProps {
    projectId?: string;
    isOverview?: boolean;
}

export const CashflowPlan = ({ projectId, isOverview }: CashflowPlanProps) => {
    // --- Tab State (URL) ---
    const tabParam = useUrlParam("tab");
    const { toast } = useToast();
    const [isDownloading, setIsDownloading] = React.useState(false);
    const [isDownloadingAll, setIsDownloadingAll] = React.useState(false);
    
    const activeTab = useMemo(() => {
        // If exact match found in values
        if (Object.values(CASHFLOW_TABS).includes(tabParam as any)) {
            return tabParam as CashflowTabValue;
        }
        return CASHFLOW_TABS.PO_CASHFLOW;
    }, [tabParam]);

    const handleTabChange = (tab: CashflowTabValue) => {
        urlStateManager.updateParam("tab", tab);
    };

    // --- Date/Duration State (Local) ---
    const activeDurationParam = useUrlParam("planningDuration");
    
    const activeDuration = useMemo(() => {
        if (activeDurationParam === "All") return "All";
        const num = Number(activeDurationParam);
        if (!isNaN(num) && [3, 7, 14].includes(num)) return num;
        if (activeDurationParam === "custom") return "custom";
        return "All"; 
    }, [activeDurationParam]);

    const startDateParam = useUrlParam("startDate");
    const endDateParam = useUrlParam("endDate");

    const dateRange = useMemo<DateRange | undefined>(() => {
        const today = startOfDay(new Date());

        if (activeDuration === "All") return undefined;
        
        if (typeof activeDuration === 'number') {
             return { from: today, to: addDays(today, activeDuration) };
        }

        if (activeDuration === 'custom') {
            if (startDateParam && endDateParam) {
                return { from: parseISO(startDateParam), to: parseISO(endDateParam) };
            }
             return undefined;
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

    const handleDownloadReport = async () => {
        if (!projectId) {
            toast({
                title: "Error",
                description: "Project ID is missing. Cannot generate report.",
                variant: "destructive"
            });
            return;
        }

        setIsDownloading(true);
        try {
            const reportName = `${activeTab} Report`;
            const formatName = "Project Cashflow Plan"; // Backend request is "Project Cashflow Plan"
            
            // Construct query params
            const queryParams = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0",
                cashflow_type: activeTab
            });

            if (dateRange?.from && dateRange?.to) {
                const start = format(dateRange.from, 'yyyy-MM-dd');
                const end = format(dateRange.to, 'yyyy-MM-dd');
                queryParams.append("start_date", start);
                queryParams.append("end_date", end);
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${queryParams.toString()}`;
            
            // Fetch Blob
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
        
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            
            // Construct Filename: {Type}_Cashflow_{Project}_{Date}.pdf
            // Sanitized Project ID logic if name not available
            const safeProjectName = projectId.replace(/ /g, "_"); 
            const safeType = activeTab.replace(/ /g, "_").replace(/\./g, "");
            const dateStr = format(new Date(), "dd-MMM-yyyy");
            
            link.download = `${safeType}_${safeProjectName}_${dateStr}.pdf`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);

            toast({
                title: "Download Complete",
                description: `Successfully downloaded ${reportName}.`,
            });
        } catch (error) {
            console.error("Download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Cashflow Plan PDF. Please check if the Print Format exists.",
                variant: "destructive",
            });
        } finally {
            setIsDownloading(false);
        }
    };

    // Download ALL cashflow types in one PDF (combined report)
    const handleDownloadAllReport = async () => {
        if (!projectId) {
            toast({
                title: "Error",
                description: "Project ID is missing. Cannot generate report.",
                variant: "destructive"
            });
            return;
        }

        setIsDownloadingAll(true);
        try {
            const formatName = "Project Cashflow Plan";
            
            // No cashflow_type param = get ALL types combined
            const queryParams = new URLSearchParams({
                doctype: "Projects",
                name: projectId,
                format: formatName,
                no_letterhead: "0"
            });

            if (dateRange?.from && dateRange?.to) {
                const start = format(dateRange.from, 'yyyy-MM-dd');
                const end = format(dateRange.to, 'yyyy-MM-dd');
                queryParams.append("start_date", start);
                queryParams.append("end_date", end);
            }

            const url = `/api/method/frappe.utils.print_format.download_pdf?${queryParams.toString()}`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
        
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            
            const safeProjectName = projectId.replace(/ /g, "_");
            const dateStr = format(new Date(), "dd-MMM-yyyy");
            
            link.download = `All_Cashflow_${safeProjectName}_${dateStr}.pdf`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);

            toast({
                title: "Download Complete",
                description: "Successfully downloaded Complete Cashflow Report.",
            });
        } catch (error) {
            console.error("Download failed:", error);
            toast({
                title: "Download Failed",
                description: "Could not download the Complete Cashflow PDF.",
                variant: "destructive",
            });
        } finally {
            setIsDownloadingAll(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header / Filter */}
            <div className="mb-6">
                <SevenDayPlanningHeader
                    isOverview={isOverview}
                    dateRange={dateRange}
                    activeDuration={activeDuration}
                    setDaysRange={setDaysRange}
                />
            </div>

            {/* Tabs Navigation */}
            <CashflowTabs 
                activeTab={activeTab} 
                onTabChange={handleTabChange} 
                rightContent={
                    <div className="flex gap-2">
                        {/* Download Current Tab */}
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleDownloadReport}
                            disabled={isDownloading}
                            className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
                        >
                            <Download className={`h-4 w-4 ${isDownloading ? "animate-bounce" : ""}`} />
                            {isDownloading ? "Downloading..." : `Download ${activeTab === "Misc. Cashflow" ? "Misc" : activeTab.split(" ")[0]}`}
                        </Button>
                        
                        {/* Download ALL Combined */}
                        <Button 
                            variant="default" 
                            size="sm" 
                            onClick={handleDownloadAllReport}
                            disabled={isDownloadingAll}
                            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            <Download className={`h-4 w-4 ${isDownloadingAll ? "animate-bounce" : ""}`} />
                            {isDownloadingAll ? "Downloading..." : "Download All"}
                        </Button>
                    </div>
                }
            />

            {/* Tab Content */}
            <div className="flex-1">
                {activeTab === CASHFLOW_TABS.PO_CASHFLOW && <POCashflow />}
                {activeTab === CASHFLOW_TABS.WO_CASHFLOW && <WOCashflow />}
                {activeTab === CASHFLOW_TABS.MISC_CASHFLOW && <MiscCashflow />}
                {activeTab === CASHFLOW_TABS.INFLOW && <InflowCashflow />}
            </div>
        </div>
    );
};
