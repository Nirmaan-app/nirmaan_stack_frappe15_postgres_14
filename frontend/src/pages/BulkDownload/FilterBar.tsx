import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { StandaloneDateFilter, DateFilterValue } from "@/components/ui/standalone-date-filter";
import { Search, Users, Sparkles, X } from "lucide-react";

interface VendorOption {
    value: string;
    label: string;
}

interface FilterBarProps {
    // Search
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
    searchPlaceholder?: string;

    // Vendor filter
    vendorOptions: VendorOption[];
    vendorFilter: string[];
    onToggleVendor: (vendorId: string) => void;

    // Date filter
    dateFilter?: DateFilterValue;
    onDateFilter: (val?: DateFilterValue) => void;

    // Status filter (optional — PO-specific)
    statusOptions?: string[];
    statusFilter?: string[];
    onToggleStatus?: (status: string) => void;

    // Clear all
    onClearFilters: () => void;

    // Selection bar (optional)
    selectedCount?: number;
    totalCount?: number;
    allSelected?: boolean;
    onSelectAll?: () => void;
    onDeselectAll?: () => void;
    /** Slot for tabs (All POs / Critical POs) */
    tabSlot?: React.ReactNode;
}

export const FilterBar = ({
    searchQuery = "",
    onSearchChange,
    searchPlaceholder = "Search...",
    vendorOptions,
    vendorFilter,
    onToggleVendor,
    dateFilter,
    onDateFilter,
    statusOptions,
    statusFilter = [],
    onToggleStatus,
    onClearFilters: _onClearFilters,
    selectedCount,
    totalCount,
    allSelected,
    onSelectAll,
    onDeselectAll,
    tabSlot,
}: FilterBarProps) => {
    const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);
    const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);

    const vendorActive = vendorFilter.length > 0;
    const dateActive = !!dateFilter;
    const statusActive = statusFilter.length > 0;

    const inactiveBtnClass = "h-9 text-xs gap-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm";
    const activeBtnClass = "h-9 text-xs gap-1.5 bg-red-500 text-white border-red-500 hover:bg-red-600 shadow-sm";

    return (
        <div className="flex flex-col gap-3">
            {/* Row 1: Search + Filter Buttons */}
            <div className="flex items-center gap-2">
                {/* Search Input */}
                {onSearchChange && (
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="h-9 pl-9 pr-8 text-sm border-gray-300"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => onSearchChange("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                )}

                {/* Vendor Button */}
                <Popover open={vendorPopoverOpen} onOpenChange={setVendorPopoverOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={vendorActive ? activeBtnClass : inactiveBtnClass}
                        >
                            <Users className="h-3.5 w-3.5" />
                            Vendor
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2" align="end">
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
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-[11px] px-2"
                                    onClick={() => {
                                        vendorFilter.forEach(onToggleVendor);
                                        setVendorPopoverOpen(false);
                                    }}
                                >
                                    Clear ({vendorFilter.length})
                                </Button>
                            </div>
                        )}
                    </PopoverContent>
                </Popover>

                {/* Date Button */}
                <div>
                    <StandaloneDateFilter
                        value={dateFilter}
                        onChange={onDateFilter} 
                        placeholder="Date"
                        triggerClassName={dateActive ? activeBtnClass : inactiveBtnClass}
                    />
                </div>

                {/* Status Button (optional) */}
                {statusOptions && statusOptions.length > 0 && onToggleStatus && (
                    <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={statusActive ? activeBtnClass : inactiveBtnClass}
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                Status
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                                Filter by Status
                            </p>
                            <div className="max-h-52 overflow-y-auto space-y-1">
                                {statusOptions.map((status) => (
                                    <div
                                        key={status}
                                        className="flex items-center gap-2 rounded px-1 py-1.5 cursor-pointer hover:bg-muted/50"
                                        onClick={() => onToggleStatus(status)}
                                    >
                                        <Checkbox
                                            checked={statusFilter.includes(status)}
                                            onCheckedChange={() => onToggleStatus(status)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <Label className="text-xs cursor-pointer truncate">{status}</Label>
                                    </div>
                                ))}
                            </div>
                            {statusFilter.length > 0 && (
                                <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-[11px] px-2"
                                        onClick={() => {
                                            statusFilter.forEach(onToggleStatus);
                                            setStatusPopoverOpen(false);
                                        }}
                                    >
                                        Clear ({statusFilter.length})
                                    </Button>
                                </div>
                            )}
                        </PopoverContent>
                    </Popover>
                )}
            </div>

            {/* Row 2: Selection Bar */}
            {totalCount != null && (
                <div className="flex items-center justify-between py-1.5">
                    {/* Left: Tabs Slot */}
                    <div className="flex-shrink-0">
                        {tabSlot}
                    </div>

                    {/* Right: Count & Select All */}
                    <div className="flex items-center gap-4 pr-1">
                        <p className="text-sm text-slate-500 font-medium">
                            {selectedCount ?? 0}/{totalCount} Selected
                        </p>
                        {onSelectAll && onDeselectAll && (
                            <div 
                                onClick={() => allSelected ? onDeselectAll() : onSelectAll()}
                                className="flex items-center gap-2.5 px-3 h-9 border border-gray-200 rounded-lg bg-white shadow-sm cursor-pointer hover:bg-gray-50 transition-all active:scale-95 select-none"
                            >
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={() => allSelected ? onDeselectAll() : onSelectAll()}
                                    className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 pointer-events-none"
                                />
                                <span className="text-sm font-semibold text-gray-700">Select All</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
