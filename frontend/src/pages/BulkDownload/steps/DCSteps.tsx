/**
 * DCSteps — Delivery Challan selection list with search + select all
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { FilterBar } from "../FilterBar";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

interface DCStepsProps {
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
    // New props for context-aware selection
    searchQuery: string;
    onSearchChange: (q: string) => void;
}

export const DCSteps = ({
    items, isLoading, selectedIds, onToggle, onSelectAll, onDeselectAll,
    onBack, onDownload, loading,
    vendorOptions, vendorFilter, onToggleVendor, dateFilter, onDateFilter, onClearFilters,
    searchQuery, onSearchChange
}: DCStepsProps) => {

    const allSelected = items.length > 0 && items.every((i) => selectedIds.includes(i.name));

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items;
        const q = searchQuery.toLowerCase();
        return items.filter((att) => {
            const poId = att.parent_docname || att.procurement_order;
            return att.name.toLowerCase().includes(q) ||
                (att.vendor_name && att.vendor_name.toLowerCase().includes(q)) ||
                (att.vendor && att.vendor.toLowerCase().includes(q)) ||
                (poId && poId.toLowerCase().includes(q));
        });
    }, [items, searchQuery]);

    const baseItems: BaseItem[] = filteredItems.map((att) => ({
        name: att.name,
        subtitle: att.vendor_name || att.vendor || "—",
        rightLabel: "DC",
        dateStr: att.creation ? formatCreationDate(att.creation) : undefined,
    }));

    const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.includes(i.name));
    const handleSelectAll = () => onSelectAll(filteredItems.map((i) => i.name));
    const handleDeselectAll = () => onDeselectAll();

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Delivery Challans</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose Delivery Challans to include in your download
                </p>
            </div>

            <FilterBar
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                searchPlaceholder="Search by ID or PO"
                vendorOptions={vendorOptions}
                vendorFilter={vendorFilter}
                onToggleVendor={onToggleVendor}
                dateFilter={dateFilter}
                onDateFilter={onDateFilter}
                onClearFilters={onClearFilters}
                selectedCount={items.filter((i) => selectedIds.includes(i.name)).length}
                totalCount={items.length}
                allSelected={allSelected}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
            />

            <BaseItemList
                items={baseItems}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onToggle={onToggle}
                emptyMessage="No Delivery Challans found for this project."
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select DCs to download" : `Download ${selectedIds.length} DC${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
