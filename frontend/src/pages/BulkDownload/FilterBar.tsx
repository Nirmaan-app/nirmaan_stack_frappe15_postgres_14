import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { StandaloneDateFilter, DateFilterValue } from "@/components/ui/standalone-date-filter";
import { Filter, X, ChevronDown } from "lucide-react";

interface VendorOption {
    value: string;
    label: string;
}

interface FilterBarProps {
    vendorOptions: VendorOption[];
    vendorFilter: string[];
    onToggleVendor: (vendorId: string) => void;
    dateFilter?: DateFilterValue;
    onDateFilter: (val?: DateFilterValue) => void;
    onClearFilters: () => void;
}

export const FilterBar = ({
    vendorOptions,
    vendorFilter,
    onToggleVendor,
    dateFilter,
    onDateFilter,
    onClearFilters,
}: FilterBarProps) => {
    const hasFilters = vendorFilter.length > 0 || !!dateFilter;
    const activeCount = (vendorFilter.length > 0 ? 1 : 0) + (dateFilter ? 1 : 0);

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Filter</span>
                {hasFilters && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">{activeCount}</Badge>
                )}
            </div>

            {/* Vendor Multiselect */}
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={`h-8 text-xs gap-1 ${vendorFilter.length ? "border-primary text-primary" : ""}`}
                    >
                        Vendor
                        {vendorFilter.length > 0 && (
                            <Badge className="h-4 px-1 text-[10px] ml-0.5">{vendorFilter.length}</Badge>
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
                                        checked={vendorFilter.includes(value)}
                                        onCheckedChange={() => onToggleVendor(value)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <Label className="text-xs cursor-pointer truncate">{label}</Label>
                                </div>
                            ))}
                        </div>
                    )}
                    {vendorFilter.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Clear:</span>
                            <Badge
                                variant="outline"
                                className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground px-1.5 h-5 text-[10px]"
                                onClick={() => vendorFilter.forEach(onToggleVendor)}
                            >
                                Vendors ({vendorFilter.length}) ✕
                            </Badge>
                        </div>
                    )}
                </PopoverContent>
            </Popover>

            {/* Date Range */}
            <div className={dateFilter ? "ring-1 ring-primary rounded-md" : ""}>
                <StandaloneDateFilter
                    value={dateFilter}
                    onChange={onDateFilter}
                />
            </div>

            {/* Clear all */}
            {hasFilters && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground gap-1 px-2"
                    onClick={onClearFilters}
                >
                    <X className="h-3 w-3" />
                    Clear
                </Button>
            )}
        </div>
    );
};
