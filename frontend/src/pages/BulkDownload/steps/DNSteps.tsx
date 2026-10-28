/**
 * DNSteps — Delivery Notes: All DNs table (facet / date filters) / Critical POs tabs
 */
import { useMemo } from "react";
import { BulkSelectTable } from "./BulkSelectTable";
import { CriticalTasksTab } from "./CriticalTasksTab";
import { dnColumns, forScope } from "./bulkTableColumns";
import { POItem, CriticalPOTask } from "../useBulkDownloadWizard";
import { BulkScopeKind, BulkTableLimits, scopeFacets, scopeNoun } from "@/utils/bulkDownload/bulkDownloadTypes";

interface DNStepsProps {
    items: POItem[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    /** Project scope only: Critical PO Tasks exist inside a project. */
    criticalTasks: CriticalPOTask[];
    onSelectMultipleCriticalTaskPOs: (taskNames: string[]) => void;
    scopeKind: BulkScopeKind;
    /** All scope: page size + selection limit (the project / vendor tabs pass none). */
    tableLimits?: BulkTableLimits;
}

export const DNSteps = ({
    items, isLoading, selectedIds, onSelectAll,
    criticalTasks, onSelectMultipleCriticalTaskPOs, scopeKind, tableLimits = {},
}: DNStepsProps) => {
    const isProject = scopeKind === "project";
    const facet = scopeFacets(scopeKind);
    const columns = useMemo(() => forScope(dnColumns, scopeKind), [scopeKind]);
    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Delivery Notes</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Choose Delivery Notes to include in your download
                </p>
            </div>

            <CriticalTasksTab
                allLabel="All DNs"
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
                    dateFilterColumns={["creation", "latest_delivery_date"]}
                    searchPlaceholder={`Search by PO ID or ${facet.title}`}
                    emptyMessage={`No delivered POs found for ${scopeNoun(scopeKind)}.`}
                    {...tableLimits}
                />
            </CriticalTasksTab>
        </div>
    );
};
