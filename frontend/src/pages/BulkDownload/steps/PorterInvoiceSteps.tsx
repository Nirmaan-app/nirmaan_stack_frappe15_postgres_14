/**
 * PorterInvoiceSteps — Report Bulk Download only: one row per Porter invoice PDF (one PDF covers many trips),
 * with Batch No / Validation Status / City filters and the Invoice Date filter. Porter Invoice data only.
 */
import { BulkSelectTable } from "./BulkSelectTable";
import { porterInvoiceColumns, porterInvoiceSummaryAmounts } from "./bulkTableColumns";
import type { PorterInvoiceRow } from "../usePorterInvoices";
import { BulkTableLimits } from "@/utils/bulkDownload/bulkDownloadTypes";

interface PorterInvoiceStepsProps {
    items: PorterInvoiceRow[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    /** All scope: page size (the page itself holds the selection limit). */
    tableLimits?: BulkTableLimits;
}

export const PorterInvoiceSteps = ({
    items, isLoading, selectedIds, onSelectAll, tableLimits = {},
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
    </div>
);
