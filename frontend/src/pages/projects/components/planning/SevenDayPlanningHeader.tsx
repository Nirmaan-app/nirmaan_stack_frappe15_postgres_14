import React from "react";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, ChevronDown, Download } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MinStandaloneDateFilter } from "@/components/ui/MinStandaloneDateFilter";

interface SevenDayPlanningHeaderProps {
  isOverview?: boolean;
  title?: string;
  dateRange: DateRange | undefined;
  activeDuration: number | "All" | "custom";
  setDaysRange: (days: number | "All" | "custom", customRange?: DateRange) => void;
  // Optional download props for pages that support it (like Cashflow)
  onDownloadCurrent?: () => void;
  onDownloadAll?: () => void;
  isDownloading?: boolean;
  isDownloadingAll?: boolean;
}

export const SevenDayPlanningHeader = ({
  isOverview,
  title,
  dateRange,
  activeDuration,
  setDaysRange,
  onDownloadCurrent,
  onDownloadAll,
  isDownloading,
  isDownloadingAll
}: SevenDayPlanningHeaderProps) => {

    // Determine title: strict prop > overview logic > default
    const displayTitle = title || (isOverview ? "Planning Overview" : "Planning");

    // Helper for button label
    const getDurationLabel = () => {
        if (activeDuration === "All") return "All Time";
        if (activeDuration === "custom") return "Custom Range";
        return `Next ${activeDuration} Days`;
    };

    return (
        <div className={cn(
            "flex flex-col md:flex-row md:items-center justify-between px-2 py-3 gap-3 bg-white border-b border-gray-100 min-h-[60px]",
            // Optional: You can restore the 'rounded card' look here if 'isOverview' is false, 
            // but for now we standardize on the new sticky-header look as requested.
        )}>
            
            {/* LEFT: Title / Context */}
            <div className="flex flex-col">
                <h1 className="text-lg font-bold text-gray-900 tracking-tight">Planning</h1> 
                <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                   Filters by date range or quick duration.
                </div>
            </div>

            {/* RIGHT: Controls */}
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
                
                {/* 1. DURATION SELECTOR (Dropdown) */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-medium border-gray-300 flex-1 md:flex-none">
                           <CalendarIcon className="w-3.5 h-3.5 text-gray-500" />
                           {getDurationLabel()}
                           <ChevronDown className="w-3 h-3 opacity-50 ml-auto md:ml-0" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuLabel className="text-[10px] uppercase text-gray-500">View Duration</DropdownMenuLabel>
                        {[3, 7, 14].map(days => (
                            <DropdownMenuItem 
                                key={days} 
                                onClick={() => setDaysRange(days)}
                                className={cn(activeDuration === days && "bg-blue-50 text-blue-700 font-semibold")}
                            >
                                Next {days} Days
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                            onClick={() => setDaysRange("All")}
                             className={cn(activeDuration === "All" && "bg-blue-50 text-blue-700 font-semibold")}
                        >
                            All Time
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                             onClick={() => setDaysRange("custom")}
                             className={cn(activeDuration === "custom" && "bg-blue-50 text-blue-700 font-semibold")}
                        >
                            Custom Range...
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* 2. CUSTOM DATE RANGE (Uses extracted component) */}
                {activeDuration === "custom" && (
                    <MinStandaloneDateFilter 
                        dateRange={dateRange} 
                        setDaysRange={setDaysRange} 
                    />
                )}

                {/* 3. EXPORT MENU (Conditionally Rendered) */}
                {onDownloadCurrent && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                             <Button size="sm" className="h-8 gap-2 bg-slate-900 hover:bg-slate-800 text-white flex-1 md:flex-none">
                                <Download className="w-3.5 h-3.5" />
                                <span className="text-xs">Export</span>
                             </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel className="text-[10px] uppercase text-gray-500">PDF Reports</DropdownMenuLabel>
                            
                            <DropdownMenuItem onClick={onDownloadCurrent} disabled={isDownloading}>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium">Current View</span>
                                    <span className="text-[10px] text-gray-500">Download active tab only</span>
                                </div>
                                {isDownloading && <span className="ml-auto text-xs animate-pulse">...</span>}
                            </DropdownMenuItem>
                            
                            {onDownloadAll && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={onDownloadAll} disabled={isDownloadingAll}>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-sm font-medium">Complete Report</span>
                                            <span className="text-[10px] text-gray-500">All Modules (PO, WO, Misc, Inflow)</span>
                                        </div>
                                        {isDownloadingAll && <span className="ml-auto text-xs animate-pulse">...</span>}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

            </div>
        </div>
    );
};
