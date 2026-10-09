/**
 * MTCSteps — Material Test Certificates: one row per certificate (like a DC), oldest certificate
 * first. A row is told apart by the items it covers; the MTC id is never shown.
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkScopeKind, scopeFacet } from "@/utils/bulkDownload/bulkDownloadTypes";
import { BulkSelectTable } from "./BulkSelectTable";
import { forScope, mtcColumns, mtcItemsText } from "./bulkTableColumns";
import { MTCRow } from "../useBulkDownloadWizard";

interface MTCStepsProps {
    items: MTCRow[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    scopeKind: BulkScopeKind;
}

export const MTCSteps = ({
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading, scopeKind,
}: MTCStepsProps) => {
    const facet = scopeFacet(scopeKind);
    const columns = useMemo(() => forScope(mtcColumns, scopeKind), [scopeKind]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Material Test Certificates</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose certificates to include in your download, oldest certificate first
                </p>
            </div>

            <BulkSelectTable
                data={items}
                columns={columns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ [facet.id]: facet.title }}
                dateFilterColumns={["certificate_date", "creation"]}
                searchPlaceholder={`Search by item, PO or ${facet.title}`}
                emptyMessage={`No material test certificates found for this ${scopeKind}.`}
                rowLabel={mtcItemsText}
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select certificates to download" : `Download ${selectedIds.length} Certificate${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
