/**
 * MIRSteps — Material Inspection Report selection list
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";
import { FilterBar } from "../FilterBar";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";

interface MIRStepsProps {
    items: AttachmentItem[];
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
    const baseItems: BaseItem[] = items.map((att) => ({
        name: att.name,
        subtitle: att.vendor_name || att.vendor || "—",
        rightLabel: "MIR",
        dateStr: att.creation ? formatCreationDate(att.creation) : undefined,
    }));

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Material Inspection Reports</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
                </p>
            </div>

            <FilterBar
                vendorOptions={vendorOptions}
                vendorFilter={vendorFilter}
                onToggleVendor={onToggleVendor}
                dateFilter={dateFilter}
                onDateFilter={onDateFilter}
                onClearFilters={onClearFilters}
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
