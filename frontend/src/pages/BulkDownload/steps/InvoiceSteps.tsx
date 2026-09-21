/**
 * InvoiceSteps — sub-type selector (All / PO Invoices / WO Invoices) + invoice table with facet / date filters
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2, FileText } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { invoiceColumns } from "./bulkTableColumns";
import { InvoiceSubType, VendorInvoice } from "../useBulkDownloadWizard";

interface InvoiceStepsProps {
    items: VendorInvoice[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    invoiceSubType: InvoiceSubType;
    onInvoiceSubTypeChange: (v: InvoiceSubType) => void;
}

const SUB_TYPES: { value: InvoiceSubType; label: string; description: string }[] = [
    { value: "All Invoices", label: "All Invoices", description: "Download all PO and WO invoices together" },
    { value: "PO Invoices", label: "PO Invoices", description: "Only invoices linked to Procurement Orders" },
    { value: "WO Invoices", label: "WO Invoices", description: "Only invoices linked to Work Orders" },
];

export const InvoiceSteps = ({
    items, isLoading, selectedIds, onSelectAll,
    onBack, onDownload, loading, invoiceSubType, onInvoiceSubTypeChange,
}: InvoiceStepsProps) => {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Invoices</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose Invoices to include in your download
                </p>
            </div>

            {/* Sub-type picker */}
            <div>
                <p className="text-sm font-medium mb-2">Invoice Type</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {SUB_TYPES.map(({ value, label, description }) => {
                        const active = invoiceSubType === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                onClick={() => onInvoiceSubTypeChange(value)}
                                className={`flex flex-col gap-1 rounded-xl border-2 p-3 text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${active ? "border-primary" : "border-muted-foreground/40"}`}>
                                        {active && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                    </div>
                                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-xs font-semibold">{label}</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground pl-5">{description}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Keyed by type: a new type is a new list, so its filters start clean. */}
            <BulkSelectTable
                key={invoiceSubType}
                data={items}
                columns={invoiceColumns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ vendor: "Vendor", type: "Type" }}
                dateFilterColumns={["invoice_date"]}
                searchPlaceholder="Search by Invoice No, Vendor or PO / WO"
                emptyMessage={`No ${invoiceSubType} with attachments found for this project.`}
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
