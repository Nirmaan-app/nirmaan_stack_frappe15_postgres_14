/**
 * ClientInvoiceSteps — client invoice (Project Invoices) selection table with customer / date filters
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { clientInvoiceColumns } from "./bulkTableColumns";
import type { ProjectInvoice } from "../useBulkDownloadWizard";

interface ClientInvoiceStepsProps {
    items: ProjectInvoice[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
}

export const ClientInvoiceSteps = ({
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading,
}: ClientInvoiceStepsProps) => (
    <div className="flex flex-col gap-4">
        <div>
            <h2 className="text-xl font-bold">Select Client Invoices</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
                Choose client invoices (Project Invoices) to include in your download
            </p>
        </div>

        <BulkSelectTable
            data={items}
            columns={clientInvoiceColumns}
            isLoading={isLoading}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectAll}
            facetColumns={{ customer: "Customer" }}
            dateFilterColumns={["invoice_date"]}
            searchPlaceholder="Search by Invoice No or Customer"
            emptyMessage="No client invoices with attachments found for this project."
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
