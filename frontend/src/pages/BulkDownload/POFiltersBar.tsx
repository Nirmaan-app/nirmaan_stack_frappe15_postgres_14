import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { MinStandaloneDateFilter } from "@/components/ui/MinStandaloneDateFilter";
import { DateRange } from "react-day-picker";
import { Filter, X, ChevronDown } from "lucide-react";

interface VendorOption {
    value: string;
    label: string;
}

interface POFiltersBarProps {
    vendorOptions: VendorOption[];
    selectedVendors: string[];
    onToggleVendor: (vendorId: string) => void;
    dateRange?: DateRange;
    onDateRange: (days: number | "All" | "custom", range?: DateRange) => void;
    onClearAll: () => void;
}

export const POFiltersBar = ({
    vendorOptions,
    selectedVendors,
    onToggleVendor,
    dateRange,
    onDateRange,
    onClearAll,
}: POFiltersBarProps) => {
    const hasActiveFilters = selectedVendors.length > 0 || !!dateRange?.from;
    const activeCount = (selectedVendors.length > 0 ? 1 : 0) + (dateRange?.from ? 1 : 0);

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Filter</span>
                {hasActiveFilters && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">{activeCount}</Badge>
                )}
            </div>

            {/* Vendor Multiselect */}
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={`h-8 text-xs gap-1 ${selectedVendors.length ? "border-primary text-primary" : ""}`}
                    >
                        Vendor
                        {selectedVendors.length > 0 && (
                            <Badge className="h-4 px-1 text-[10px] ml-0.5">{selectedVendors.length}</Badge>
                        )}
                        <ChevronDown className="h-3 w-3 ml-0.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                        Filter by Vendor
                    </p>
                    {vendorOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-1">No vendors found</p>
                    ) : (
                        <div className="max-h-52 overflow-y-auto space-y-1">
                            {vendorOptions.map(({ value, label }) => (
                                <div
                                    key={value}
                                    className="flex items-center gap-2 rounded px-1 py-1.5 cursor-pointer hover:bg-muted/50"
                                    onClick={() => onToggleVendor(value)}
                                >
                                    <Checkbox
                                        checked={selectedVendors.includes(value)}
                                        onCheckedChange={() => onToggleVendor(value)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <Label className="text-xs cursor-pointer truncate">{label}</Label>
                                </div>
                            ))}
                        </div>
                    )}
                    {selectedVendors.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-2 h-6 text-xs text-muted-foreground"
                            onClick={() => selectedVendors.forEach(onToggleVendor)}
                        >
                            Clear vendor filter
                        </Button>
                    )}
                </PopoverContent>
            </Popover>

            {/* Date Range */}
            <div className={dateRange?.from ? "ring-1 ring-primary rounded-md" : ""}>
                <MinStandaloneDateFilter
                    dateRange={dateRange}
                    setDaysRange={onDateRange}
                />
            </div>

            {/* Clear all */}
            {hasActiveFilters && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground gap-1 px-2"
                    onClick={onClearAll}
                >
                    <X className="h-3 w-3" />
                    Clear
                </Button>
            )}
        </div>
    );
};
