import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, Download, Loader2, Search, X, Building2 } from "lucide-react";
import { StandaloneDateFilter, DateFilterValue } from "@/components/ui/standalone-date-filter";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import type { ProjectInvoice } from "../useBulkDownloadWizard";

interface CustomerOption {
    value: string;
    label: string;
}

interface ClientInvoiceStepsProps {
    items: ProjectInvoice[];
    isLoading: boolean;
    selectedIds: string[];
    onToggle: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onDeselectAll: () => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    customerOptions: CustomerOption[];
    customerFilter: string[];
    onToggleCustomer: (c: string) => void;
    dateFilter?: DateFilterValue;
    onDateFilter: (v?: DateFilterValue) => void;
    onClearFilters: () => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
}

export const ClientInvoiceSteps = ({
    items,
    isLoading,
    selectedIds,
    onToggle,
    onSelectAll,
    onDeselectAll,
    onBack,
    onDownload,
    loading,
    customerOptions,
    customerFilter,
    onToggleCustomer,
    dateFilter,
    onDateFilter,
    onClearFilters,
    searchQuery,
    onSearchChange,
}: ClientInvoiceStepsProps) => {
    const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);

    const baseItems: BaseItem[] = useMemo(() => items.map((pi) => ({
        name: pi.name,
        subtitle: pi.company_name || pi.customer || "—",
        rightLabel: pi.invoice_no,
        dateStr: pi.invoice_date ? formatCreationDate(`${pi.invoice_date} 00:00:00`) : undefined,
    })), [items]);

    const allSelected = items.length > 0 && items.every((i) => selectedIds.includes(i.name));
    const handleSelectAll = () => onSelectAll(items.map((i) => i.name));

    const customerActive = customerFilter.length > 0;
    const dateActive = !!dateFilter;
    const inactiveBtnClass = "h-9 text-xs gap-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm";
    const activeBtnClass = "h-9 text-xs gap-1.5 bg-red-500 text-white border-red-500 hover:bg-red-600 shadow-sm";

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Client Invoices</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose client invoices (Project Invoices) to include in your download
                </p>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by Invoice No, Customer"
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

                    <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={customerActive ? activeBtnClass : inactiveBtnClass}
                            >
                                <Building2 className="h-3.5 w-3.5" />
                                Customer
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2" align="end">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                                Filter by Customer
                            </p>
                            {customerOptions.length === 0 ? (
                                <p className="text-xs text-muted-foreground px-1">No customers found</p>
                            ) : (
                                <div className="max-h-52 overflow-y-auto space-y-1">
                                    {customerOptions.map(({ value, label }) => (
                                        <div
                                            key={value}
                                            className="flex items-center gap-2 rounded px-1 py-1.5 cursor-pointer hover:bg-muted/50"
                                            onClick={() => onToggleCustomer(value)}
                                        >
                                            <Checkbox
                                                checked={customerFilter.includes(value)}
                                                onCheckedChange={() => onToggleCustomer(value)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <Label className="text-xs cursor-pointer truncate">{label}</Label>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {customerFilter.length > 0 && (
                                <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-[11px] px-2"
                                        onClick={() => {
                                            customerFilter.forEach(onToggleCustomer);
                                            setCustomerPopoverOpen(false);
                                        }}
                                    >
                                        Clear ({customerFilter.length})
                                    </Button>
                                </div>
                            )}
                        </PopoverContent>
                    </Popover>

                    <StandaloneDateFilter
                        value={dateFilter}
                        onChange={onDateFilter}
                        placeholder="Invoice Date"
                        triggerClassName={dateActive ? activeBtnClass : inactiveBtnClass}
                    />
                </div>

                <div className="flex items-center justify-between py-1.5">
                    <div />
                    <div className="flex items-center gap-4 pr-1">
                        <p className="text-sm text-slate-500 font-medium">
                            {items.filter((i) => selectedIds.includes(i.name)).length}/{items.length} Selected
                        </p>
                        <div
                            onClick={() => (allSelected ? onDeselectAll() : handleSelectAll())}
                            className="flex items-center gap-2.5 px-3 h-9 border border-gray-200 rounded-lg bg-white shadow-sm cursor-pointer hover:bg-gray-50 transition-all active:scale-95 select-none"
                        >
                            <Checkbox
                                checked={allSelected}
                                onCheckedChange={() => (allSelected ? onDeselectAll() : handleSelectAll())}
                                className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 pointer-events-none"
                            />
                            <span className="text-sm font-semibold text-gray-700">Select All</span>
                        </div>
                    </div>
                </div>
            </div>

            <BaseItemList
                items={baseItems}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onToggle={onToggle}
                emptyMessage="No client invoices with attachments found for this project."
                onClearFilters={searchQuery || dateFilter || customerFilter.length ? onClearFilters : undefined}
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select invoices to download" : `Download ${selectedIds.length} Invoice${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
