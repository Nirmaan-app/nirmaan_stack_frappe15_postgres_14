/**
 * WOSteps — Work Order selection list with search + select all
 */
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { WOItem } from "../useBulkDownloadWizard";
import { FilterBar } from "../FilterBar";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { useUserData } from "@/hooks/useUserData";

interface WOStepsProps {
    items: WOItem[];
    isLoading: boolean;
    selectedIds: string[];
    onToggle: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onDeselectAll: () => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    withRate: boolean;
    onWithRateChange: (v: boolean) => void;
    vendorOptions: { value: string; label: string }[];
    vendorFilter: string[];
    onToggleVendor: (v: string) => void;
    dateFilter?: DateFilterValue;
    onDateFilter: (v?: DateFilterValue) => void;
    onClearFilters: () => void;
    filteredItems: WOItem[];
    searchQuery: string;
    onSearchChange: (q: string) => void;
}

export const WOSteps = ({
    items, isLoading, selectedIds, onToggle, onSelectAll, onDeselectAll,
    onBack, onDownload, loading,
    withRate, onWithRateChange,
    vendorOptions, vendorFilter, onToggleVendor, dateFilter, onDateFilter, onClearFilters,
    filteredItems, searchQuery, onSearchChange
}: WOStepsProps) => {
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";
    const effectiveWithRate = isProjectManager ? false : withRate;
    const baseItems: BaseItem[] = filteredItems.map((wo) => ({
        name: wo.name,
        subtitle: wo.vendor_name || wo.vendor || "—",
        status: wo.status,
        dateStr: formatCreationDate(wo.creation),
    }));

    const allSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.includes(i.name));
    const handleSelectAll = () => onSelectAll(filteredItems.map((i) => i.name));
    const handleDeselectAll = () => onDeselectAll();

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold">Select Work Orders</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Choose Work Orders to include in your download
                    </p>
                </div>
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${isProjectManager ? "bg-muted/70 opacity-80" : "bg-muted/40"}`}>
                    <Label htmlFor="wo-with-rate" className={`text-sm ${isProjectManager ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                        {effectiveWithRate ? "With Rate" : "Without Rate"}
                    </Label>
                    <Switch
                        id="wo-with-rate"
                        checked={effectiveWithRate}
                        onCheckedChange={onWithRateChange}
                        disabled={isProjectManager}
                    />
                </div>
            </div>

            <FilterBar
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                searchPlaceholder="Search by WO ID"
                vendorOptions={vendorOptions}
                vendorFilter={vendorFilter}
                onToggleVendor={onToggleVendor}
                dateFilter={dateFilter}
                onDateFilter={onDateFilter}
                onClearFilters={onClearFilters}
                selectedCount={filteredItems.filter((i) => selectedIds.includes(i.name)).length}
                totalCount={filteredItems.length}
                allSelected={allSelected}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
            />

            <BaseItemList
                items={baseItems}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onToggle={onToggle}
                emptyMessage="No Work Orders found for this project."
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-40">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select WOs to download" : `Download ${selectedIds.length} WO${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
