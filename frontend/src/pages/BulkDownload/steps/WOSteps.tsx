/**
 * WOSteps — Work Order selection table with facet / date filters + select all
 */
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BulkSelectTable } from "./BulkSelectTable";
import { useMemo } from "react";
import { forScope, woColumns, woSummaryAmounts } from "./bulkTableColumns";
import { WOItem } from "../useBulkDownloadWizard";
import { useUserData } from "@/hooks/useUserData";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";

interface WOStepsProps {
    items: WOItem[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    withRate: boolean;
    onWithRateChange: (v: boolean) => void;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
}

export const WOSteps = ({
    items, isLoading, selectedIds, onSelectAll,
    withRate, onWithRateChange, scopeKind, tableLimits = {},
}: WOStepsProps) => {
    const { role } = useUserData();
    const facet = scopeFacets(scopeKind);
    const columns = useMemo(() => forScope(woColumns, scopeKind), [scopeKind]);
    const isProjectManager = role === "Nirmaan Project Manager Profile";
    const effectiveWithRate = isProjectManager ? false : withRate;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold">Select Work Orders</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Choose Work Orders to include in your download
                    </p>
                </div>
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${isProjectManager ? "bg-muted/70 opacity-80" : "bg-muted/40"}`}>
                    <Label htmlFor="wo-with-rate" className={`text-sm ${isProjectManager ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                        {effectiveWithRate ? "With Rate" : "Without Rate"}
                    </Label>
                    <Switch
                        id="wo-with-rate"
                        checked={effectiveWithRate}
                        onCheckedChange={onWithRateChange}
                        disabled={isProjectManager}
                    />
                </div>
            </div>

            <BulkSelectTable
                data={items}
                columns={columns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ ...facet.columns }}
                dateFilterColumns={["creation"]}
                searchPlaceholder={`Search by WO ID or ${facet.title}`}
                emptyMessage={`No Work Orders found for ${scopeNoun(scopeKind)}.`}
                {...tableLimits}
                summaryAmounts={woSummaryAmounts}
            />
        </div>
    );
};
