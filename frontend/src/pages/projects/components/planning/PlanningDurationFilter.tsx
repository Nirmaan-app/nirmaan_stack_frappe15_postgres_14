import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MinStandaloneDateFilter } from "@/components/ui/MinStandaloneDateFilter";

/** A planning date filter value: Next N days, All Time, or a custom range. */
export type PlanningDuration = number | "All" | "custom";

interface PlanningDurationFilterProps {
    dateRange: DateRange | undefined;
    activeDuration: PlanningDuration;
    setDaysRange: (days: PlanningDuration, customRange?: DateRange) => void;
}

/**
 * The planning date filter: Next 3/7/14 Days, All Time or Custom Range (its picker shows only for Custom).
 * Sits inside each planning tab: the Work Plan's Planned Activities view, the Material Plan title row and
 * the Cashflow sub-tab row. All three read the same URL params, so a choice carries across the tabs.
 */
export const PlanningDurationFilter = ({ dateRange, activeDuration, setDaysRange }: PlanningDurationFilterProps) => {
    const durationLabel =
        activeDuration === "All" ? "All Time" : activeDuration === "custom" ? "Custom Range" : `Next ${activeDuration} Days`;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-medium border-gray-300 flex-1 md:flex-none">
                       <CalendarIcon className="w-3.5 h-3.5 text-gray-500" />
                       {durationLabel}
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

            {activeDuration === "custom" && (
                <MinStandaloneDateFilter
                    dateRange={dateRange}
                    setDaysRange={setDaysRange}
                />
            )}
        </>
    );
};
