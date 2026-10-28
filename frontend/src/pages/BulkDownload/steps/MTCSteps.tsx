/**
 * MTCSteps — Material Test Certificates: one row per certificate (like a DC), oldest certificate
 * first. A row is told apart by the items it covers; the MTC id is never shown.
 */
import { useMemo } from "react";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";
import { BulkSelectTable } from "./BulkSelectTable";
import { forScope, mtcColumns, mtcItemsText } from "./bulkTableColumns";
import { MTCRow } from "../useBulkDownloadWizard";

interface MTCStepsProps {
    items: MTCRow[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
}

export const MTCSteps = ({
    items, isLoading, selectedIds, onSelectAll, scopeKind, tableLimits = {},
}: MTCStepsProps) => {
    const facet = scopeFacets(scopeKind);
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
                facetColumns={{ ...facet.columns }}
                dateFilterColumns={["certificate_date", "creation"]}
                searchPlaceholder={`Search by item, PO or ${facet.title}`}
                emptyMessage={`No material test certificates found for ${scopeNoun(scopeKind)}.`}
                {...tableLimits}
                rowLabel={mtcItemsText}
            />
        </div>
    );
};
