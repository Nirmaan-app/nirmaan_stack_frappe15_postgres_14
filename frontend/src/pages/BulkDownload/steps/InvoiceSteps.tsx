/**
 * InvoiceSteps — sub-type selector (All / PO Invoices / WO Invoices) + invoice table with facet / date filters
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2, FileText } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { useMemo } from "react";
import { forScope, invoiceColumns } from "./bulkTableColumns";
import { InvoiceSubType, VendorInvoice } from "../useBulkDownloadWizard";
import { BulkScopeKind, INVOICE_SUB_TYPES, scopeFacet } from "@/utils/bulkDownload/bulkDownloadTypes";

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
    /** The choices this scope offers (`invoiceSubTypesFor`). */
    subTypes: InvoiceSubType[];
    scopeKind: BulkScopeKind;
}

export const InvoiceSteps = ({
    items, isLoading, selectedIds, onSelectAll,
    onBack, onDownload, loading, invoiceSubType, onInvoiceSubTypeChange, subTypes, scopeKind,
}: InvoiceStepsProps) => {
    const facet = scopeFacet(scopeKind);
    const columns = useMemo(() => forScope(invoiceColumns, scopeKind), [scopeKind]);
    const choices = INVOICE_SUB_TYPES.filter((t) => subTypes.includes(t.value));

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
                <div className={`grid grid-cols-1 ${choices.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"} gap-2`}>
                    {choices.map(({ value, label, description }) => {
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
                columns={columns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ [facet.id]: facet.title, type: "Type" }}
                dateFilterColumns={["invoice_date"]}
                searchPlaceholder={`Search by Invoice No, ${facet.title} or PO / WO`}
                emptyMessage={`No ${invoiceSubType} with attachments found for this ${scopeKind}.`}
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
