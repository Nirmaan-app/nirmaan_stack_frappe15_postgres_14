/**
 * ClientInvoiceSteps — client invoice (Project Invoices) selection table with customer / date filters
 * (plus a Project filter in the all scope; a vendor never has client invoices)
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { clientInvoiceColumns, clientInvoiceSummaryAmounts, forScope } from "./bulkTableColumns";
import type { ProjectInvoice } from "../useBulkDownloadWizard";
import { BulkScopeKind, BulkTableLimits, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";

interface ClientInvoiceStepsProps {
    items: ProjectInvoice[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project tab passes none). */
    tableLimits?: BulkTableLimits;
    /** False when the page shows Back and Download at the top instead (Reports > Bulk Download). */
    showFooter?: boolean;
}

export const ClientInvoiceSteps = ({
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading, scopeKind, tableLimits = {}, showFooter = true,
}: ClientInvoiceStepsProps) => {
    const isAll = scopeKind === "all";
    const columns = useMemo(() => forScope(clientInvoiceColumns, scopeKind), [scopeKind]);
    return (
    <div className="flex flex-col gap-4">
        <div>
            <h2 className="text-xl font-bold">Select Client Invoices</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
                Choose client invoices (Project Invoices) to include in your download
            </p>
        </div>

        <BulkSelectTable
            data={items}
            columns={columns}
            isLoading={isLoading}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectAll}
            facetColumns={isAll ? { project: "Project", customer: "Customer" } : { customer: "Customer" }}
            dateFilterColumns={["invoice_date"]}
            searchPlaceholder={isAll ? "Search by Invoice No, Project or Customer" : "Search by Invoice No or Customer"}
            emptyMessage={`No client invoices with attachments found for ${scopeNoun(scopeKind)}.`}
            {...tableLimits}
            summaryAmounts={clientInvoiceSummaryAmounts}
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
};
