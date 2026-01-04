import React from "react";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { Button } from "@/components/ui/button";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

interface SevenDayPlanningHeaderProps {
  isOverview?: boolean;
  dateRange: DateRange | undefined;
  activeDuration: number | "All" | "custom";
  setDaysRange: (days: number | "All" | "custom", customRange?: DateRange) => void;
}

export const SevenDayPlanningHeader = ({
  isOverview,
  dateRange,
  activeDuration,
  setDaysRange,
}: SevenDayPlanningHeaderProps) => {
  return (
    <div className={cn(
        "flex flex-col gap-4",
        isOverview ? "" : "border border-[#D7D7EC] rounded-xl p-6 bg-white-50"
    )}>
      <div>
        <h2 className="text-2xl font-semibold">{isOverview ? "Planning Overview" : "Planning"}</h2>
        <p className="text-gray-500 text-sm mt-1">Filters by date range or quick duration.</p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {/* Date Filter */}
        <StandaloneDateFilter
          value={dateRange}
          onChange={(val) => {
              if (val?.from && val?.to) {
                   setDaysRange('custom', val);
              } else if (!val) {
                  setDaysRange('All');
              }
          }}
          onClear={() => {
              setDaysRange("All");
          }}
        />

        {/* Duration Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {[3, 7, 14, "All"].map((duration) => (
              <Button
              key={duration}
              variant={activeDuration === duration ? "default" : "outline"}
              className={cn(
                  activeDuration === duration 
                      ? "bg-red-600 hover:bg-red-700 text-white" 
                      : "bg-white text-gray-400  hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-[#D7D7EC]"
              )}
              onClick={() => setDaysRange(duration as number | "All")}
              >
              {duration === "All" ? "All" : `${duration} Days`}
              </Button>
          ))}
        </div>
      </div>
    </div>
  );
};
