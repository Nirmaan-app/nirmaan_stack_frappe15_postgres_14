/**
 * PorterInvoiceSteps — Report Bulk Download only: one row per Porter invoice PDF (one PDF covers many trips),
 * with Batch No / Validation Status / City filters and the Invoice Date filter. Porter Invoice data only.
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { porterInvoiceColumns, porterInvoiceSummaryAmounts } from "./bulkTableColumns";
import type { PorterInvoiceRow } from "../usePorterInvoices";
import { BulkTableLimits } from "@/utils/bulkDownload/bulkDownloadTypes";

interface PorterInvoiceStepsProps {
    items: PorterInvoiceRow[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    /** All scope: page size (the page itself holds the selection limit). */
    tableLimits?: BulkTableLimits;
    /** False when the page shows Back and Download at the top instead (Reports > Bulk Download). */
    showFooter?: boolean;
}

export const PorterInvoiceSteps = ({
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading, tableLimits = {}, showFooter = true,
}: PorterInvoiceStepsProps) => (
    <div className="flex flex-col gap-4">
        <div>
            <h2 className="text-xl font-bold">Select Porter Invoices</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
                Each row is one Porter invoice PDF. Its trips are inside that PDF.
            </p>
        </div>

        <BulkSelectTable
            data={items}
            columns={porterInvoiceColumns}
            isLoading={isLoading}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectAll}
            facetColumns={{ import_batch: "Batch No", validation_status: "Validation Status", city: "City" }}
            dateFilterColumns={["read_invoice_date"]}
            searchPlaceholder="Search by Invoice No, Batch No or City"
            emptyMessage="No Porter invoices with a PDF found."
            {...tableLimits}
            summaryAmounts={porterInvoiceSummaryAmounts}
        />

        <div className={`flex items-center justify-between pt-2${showFooter ? "" : " hidden"}`}>
            <Button variant="ghost" onClick={onBack} disabled={loading}>
                <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44 ml-auto">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                {loading ? "Generating..." : selectedIds.length === 0 ? "Select invoices to download" : `Download ${selectedIds.length} Invoice${selectedIds.length !== 1 ? "s" : ""}`}
            </Button>
        </div>
    </div>
);
