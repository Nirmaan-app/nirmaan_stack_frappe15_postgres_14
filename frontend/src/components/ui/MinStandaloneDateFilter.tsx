import React from "react";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { datePresets, DatePreset } from "@/utils/datePresents";
import { formatDate } from "@/utils/FormatDate";

interface MinStandaloneDateFilterProps {
    dateRange?: DateRange;
    setDaysRange: (days: number | "All" | "custom", range?: DateRange) => void;
}

export const MinStandaloneDateFilter = ({ 
    dateRange, 
    setDaysRange 
}: MinStandaloneDateFilterProps) => {
    const [open, setOpen] = React.useState(false);
    const [tempDate, setTempDate] = React.useState<DateRange | undefined>(dateRange);
    const [isMobile, setIsMobile] = React.useState(false);

    React.useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    React.useEffect(() => {
        if (open) {
            setTempDate(dateRange);
        }
    }, [open, dateRange]);

    // Derive label for presets (e.g. "Last 7 Days")
    const selectedPresetLabel = React.useMemo(() => {
        if (!dateRange?.from || !dateRange?.to) return null;
        
        const fromStr = format(dateRange.from, 'yyyy-MM-dd');
        const toStr = format(dateRange.to, 'yyyy-MM-dd');
        
        for (const preset of datePresets) {
            const range = preset.getRange();
            if (!range?.from || !range?.to) continue;
            if (format(range.from, 'yyyy-MM-dd') === fromStr && format(range.to, 'yyyy-MM-dd') === toStr) {
                return preset.label;
            }
        }
        return null;
    }, [dateRange]);

    const handleApply = () => {
        if (tempDate?.from && tempDate?.to) {
            setDaysRange("custom", tempDate);
            setOpen(false);
        }
    };

    const handleReset = () => {
        setDaysRange("All"); // Revert to All/Default
        setOpen(false);
    };

    const handlePresetClick = (preset: DatePreset) => {
        const range = preset.getRange();
        if (range) {
             setTempDate(range);
             // Auto-apply logic similar to standalone
             setDaysRange("custom", range);
             setOpen(false);
        }
    };
    
    const handleClearSelection = () => {
        setTempDate(undefined);
        setDaysRange("All"); // Immediately clear filter
    };

    const formatTempDate = (range?: DateRange) => {
        if (!range?.from) return 'No selection';
        return range.to
          ? `${formatDate(range.from)} - ${formatDate(range.to)}`
          : formatDate(range.from);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    id="date"
                    variant={"outline"}
                    size="sm"
                    className={cn(
                        "h-8 justify-start text-xs font-normal border-gray-300 w-full md:w-[200px] flex-1 md:flex-none",
                        !dateRange?.from && "text-muted-foreground"
                    )}
                >
                    {selectedPresetLabel ? (
                        <span className="font-semibold text-blue-700">{selectedPresetLabel}</span>
                    ) : dateRange?.from ? (
                        dateRange.to ? (
                            <>
                                {format(dateRange.from, "LLL dd")} -{" "}
                                {format(dateRange.to, "LLL dd, y")}
                            </>
                        ) : (
                            format(dateRange.from, "LLL dd, y")
                        )
                    ) : (
                        <span>Pick a date range</span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-[100vw] p-0 flex flex-col md:flex-row" align="end">
                 {/* Sidebar: Presets (Top scrollable on mobile, Left vertical on desktop) */}
                 <div className="flex flex-row md:flex-col p-2 bg-gray-50/50 border-b md:border-b-0 md:border-r gap-2 overflow-x-auto md:overflow-visible w-full md:w-auto md:min-w-[140px] no-scrollbar">
                    {datePresets.map((preset) => (
                      <Button
                        key={preset.label}
                        variant="ghost"
                        size="sm"
                        className="justify-start text-xs h-7 md:h-8 whitespace-nowrap shrink-0"
                        onClick={() => handlePresetClick(preset)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                 </div>

                 {/* Main: Calendar & Actions */}
                 <div className="flex flex-col">
                      <div className="flex justify-between items-center p-3 border-b bg-white">
                        <span className="text-xs font-semibold text-gray-700 truncate mr-2">
                          {formatTempDate(tempDate)}
                        </span>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-[10px] text-gray-500 hover:text-red-500 shrink-0"
                            onClick={handleClearSelection}
                            disabled={!tempDate?.from}
                        >
                            Clear
                        </Button>
                      </div>
                      
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={tempDate?.from}
                        selected={tempDate}
                        onSelect={setTempDate}
                        numberOfMonths={isMobile ? 1 : 2}
                        className="p-2 md:p-3"
                      />
                      
                      <div className="p-2 border-t flex justify-end gap-2 bg-gray-50/50">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 text-xs" 
                            onClick={handleReset}
                        >
                            Reset
                        </Button>
                        <Button 
                            size="sm" 
                            className="h-7 text-xs bg-slate-900 text-white hover:bg-slate-800" 
                            onClick={handleApply} 
                            disabled={!tempDate?.from || !tempDate?.to}
                        >
                            Apply
                        </Button>
                      </div>
                 </div>
            </PopoverContent>
        </Popover>
    );
};
