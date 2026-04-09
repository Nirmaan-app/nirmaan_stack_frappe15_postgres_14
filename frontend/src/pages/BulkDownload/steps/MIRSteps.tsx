/**
 * MIRSteps — Material Inspection Report selection list with search + select all
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { FilterBar } from "../FilterBar";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface MIRStepsProps {
    items: PODeliveryDocuments[];
    isLoading: boolean; 
    selectedIds: string[];
    onToggle: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onDeselectAll: () => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    vendorOptions: { value: string; label: string }[];
    vendorFilter: string[];
    onToggleVendor: (v: string) => void;
    dateFilter?: DateFilterValue;
    onDateFilter: (v?: DateFilterValue) => void;
    onClearFilters: () => void;
}

export const MIRSteps = ({
    items, isLoading, selectedIds, onToggle, onSelectAll, onDeselectAll,
    onBack, onDownload, loading,
    vendorOptions, vendorFilter, onToggleVendor, dateFilter, onDateFilter, onClearFilters
}: MIRStepsProps) => {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(
            (att) =>
                att.name.toLowerCase().includes(q) ||
                (att.vendor_name && att.vendor_name.toLowerCase().includes(q)) ||
                (att.vendor && att.vendor.toLowerCase().includes(q)) ||
                (att.procurement_order && att.procurement_order.toLowerCase().includes(q))
        );
    }, [items, searchQuery]);

    const baseItems: BaseItem[] = filteredItems.map((att) => ({
        name: att.name,
        subtitle: att.vendor_name || att.vendor || "—",
        rightLabel: "MIR",
        dateStr: att.creation ? formatCreationDate(att.creation) : undefined,
    }));

    const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.includes(i.name));
    const handleSelectAll = () => onSelectAll(filteredItems.map((i) => i.name));
    const handleDeselectAll = () => onDeselectAll();

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Material Inspection Reports</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose MIRs to include in your download
                </p>
            </div>

            <FilterBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="Search by MIR number"
                vendorOptions={vendorOptions}
                vendorFilter={vendorFilter}
                onToggleVendor={onToggleVendor}
                dateFilter={dateFilter}
                onDateFilter={onDateFilter}
                onClearFilters={() => { onClearFilters(); setSearchQuery(""); }}
                selectedCount={selectedIds.length}
                totalCount={items.length}
                allSelected={allFilteredSelected}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
            />

            <BaseItemList
                items={baseItems}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onToggle={onToggle}
                emptyMessage="No MIRs found for this project."
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select MIRs to download" : `Download ${selectedIds.length} MIR${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
