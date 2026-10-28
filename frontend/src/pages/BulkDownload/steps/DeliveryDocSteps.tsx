/**
 * DCSteps / MIRSteps — Delivery Challan and Material Inspection Report selection tables.
 *
 * The two differ only in their columns and wording, so they are one component with two exports.
 */
import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { BulkSelectTable } from "./BulkSelectTable";
import { dcColumns, forScope, mirColumns } from "./bulkTableColumns";
import { PODeliveryDocuments } from "../useBulkDownloadWizard";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";

interface DeliveryDocStepsProps {
    items: PODeliveryDocuments[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
}

interface DeliveryDocKind {
    title: string;
    short: string;
    columns: ColumnDef<PODeliveryDocuments, any>[];
}

const DeliveryDocStep = ({
    kind: { title, short, columns },
    items, isLoading, selectedIds, onSelectAll, scopeKind, tableLimits = {},
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
        </div>
    );
};

const DC_KIND: DeliveryDocKind = { title: "Delivery Challans", short: "DC", columns: dcColumns };
const MIR_KIND: DeliveryDocKind = { title: "Material Inspection Reports", short: "MIR", columns: mirColumns };

export const DCSteps = (props: DeliveryDocStepsProps) => <DeliveryDocStep kind={DC_KIND} {...props} />;
export const MIRSteps = (props: DeliveryDocStepsProps) => <DeliveryDocStep kind={MIR_KIND} {...props} />;
