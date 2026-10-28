/**
 * DCSteps / MIRSteps — Delivery Challan and Material Inspection Report selection tables.
 *
 * The two differ only in their columns and wording, so they are one component with two exports.
 */
import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { dcColumns, forScope, mirColumns } from "./bulkTableColumns";
import { PODeliveryDocuments } from "../useBulkDownloadWizard";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";

interface DeliveryDocStepsProps {
    items: PODeliveryDocuments[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
    /** False when the page shows Back and Download at the top instead (Reports > Bulk Download). */
    showFooter?: boolean;
}

interface DeliveryDocKind {
    title: string;
    short: string;
    columns: ColumnDef<PODeliveryDocuments, any>[];
}

const DeliveryDocStep = ({
    kind: { title, short, columns },
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading, scopeKind, tableLimits = {}, showFooter = true,
}: DeliveryDocStepsProps & { kind: DeliveryDocKind }) => {
    const facet = scopeFacets(scopeKind);
    const scopedColumns = useMemo(() => forScope(columns, scopeKind), [columns, scopeKind]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select {title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose {short}s to include in your download
                </p>
            </div>

            <BulkSelectTable
                data={items}
                columns={scopedColumns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ ...facet.columns }}
                dateFilterColumns={["dc_date", "creation"]}
                searchPlaceholder={`Search by ${short} No., PO or ${facet.title}`}
                emptyMessage={`No ${title} with attachments found for ${scopeNoun(scopeKind)}.`}
                {...tableLimits}
            />

            <div className={`flex items-center justify-between pt-2${showFooter ? "" : " hidden"}`}>
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44 ml-auto">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? `Select ${short}s to download` : `Download ${selectedIds.length} ${short}${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};

const DC_KIND: DeliveryDocKind = { title: "Delivery Challans", short: "DC", columns: dcColumns };
const MIR_KIND: DeliveryDocKind = { title: "Material Inspection Reports", short: "MIR", columns: mirColumns };

export const DCSteps = (props: DeliveryDocStepsProps) => <DeliveryDocStep kind={DC_KIND} {...props} />;
export const MIRSteps = (props: DeliveryDocStepsProps) => <DeliveryDocStep kind={MIR_KIND} {...props} />;
