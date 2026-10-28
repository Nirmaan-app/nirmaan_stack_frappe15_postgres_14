/**
 * POSteps — PO rate option + All POs table (facet / date filters) / Critical POs tabs
 */
import { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BulkSelectTable } from "./BulkSelectTable";
import { CriticalTasksTab } from "./CriticalTasksTab";
import { forScope, poColumns, poSummaryAmounts } from "./bulkTableColumns";
import { POItem, CriticalPOTask } from "../useBulkDownloadWizard";
import { useUserData } from "@/hooks/useUserData";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";

interface POStepsProps {
    items: POItem[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    withRate: boolean;
    onWithRateChange: (v: boolean) => void;
    // Critical tasks (project scope only: Critical PO Tasks exist inside a project)
    criticalTasks: CriticalPOTask[];
    onSelectMultipleCriticalTaskPOs: (taskNames: string[]) => void;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
}

export const POSteps = ({
    items,
    isLoading,
    selectedIds,
    onSelectAll,
    withRate,
    onWithRateChange,
    criticalTasks,
    onSelectMultipleCriticalTaskPOs,
    scopeKind,
    tableLimits = {},
}: POStepsProps) => {
    const { role } = useUserData();
    const isProject = scopeKind === "project";
    const facet = scopeFacets(scopeKind);
    const columns = useMemo(() => forScope(poColumns, scopeKind), [scopeKind]);
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    // Enforce without rate for Project Managers natively
    const effectiveWithRate = isProjectManager ? false : withRate;

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold">Select Procurement Orders</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Choose Procurement Orders to include in your download
                    </p>
                </div>
                {/* Rate toggle */}
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${isProjectManager ? "bg-muted/70 opacity-80" : "bg-muted/40"}`}>
                    <Label htmlFor="with-rate" className={`text-sm ${isProjectManager ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                        {effectiveWithRate ? "With Rate" : "Without Rate"}
                    </Label>
                    <Switch
                        id="with-rate"
                        checked={effectiveWithRate}
                        onCheckedChange={onWithRateChange}
                        disabled={isProjectManager}
                    />
                </div>
            </div>

            <CriticalTasksTab
                allLabel="All POs"
                allCount={items.length}
                showCritical={isProject}
                criticalTasks={criticalTasks}
                selectedCount={selectedIds.length}
                onSelectTasks={onSelectMultipleCriticalTaskPOs}
            >
                <BulkSelectTable
                    data={items}
                    columns={columns}
                    isLoading={isLoading}
                    selectedIds={selectedIds}
                    onSelectedIdsChange={onSelectAll}
                    facetColumns={{ ...facet.columns, status: "Status" }}
                    dateFilterColumns={["creation"]}
                    searchPlaceholder={`Search by PO ID or ${facet.title}`}
                    emptyMessage={`No POs found for ${scopeNoun(scopeKind)}.`}
                    {...tableLimits}
                    summaryAmounts={poSummaryAmounts}
                />
            </CriticalTasksTab>
        </div>
    );
};
