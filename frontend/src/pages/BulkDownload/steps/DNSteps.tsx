/**
 * DNSteps — Delivery Notes: All DNs table (facet / date filters) / Critical POs tabs
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { CriticalTasksTab } from "./CriticalTasksTab";
import { dnColumns, forScope } from "./bulkTableColumns";
import { POItem, CriticalPOTask } from "../useBulkDownloadWizard";
import { BulkScopeKind, scopeFacet } from "@/utils/bulkDownload/bulkDownloadTypes";

interface DNStepsProps {
    items: POItem[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    /** Project scope only: Critical PO Tasks exist inside a project. */
    criticalTasks: CriticalPOTask[];
    onSelectMultipleCriticalTaskPOs: (taskNames: string[]) => void;
    scopeKind: BulkScopeKind;
}

export const DNSteps = ({
    items, isLoading, selectedIds, onSelectAll,
    onBack, onDownload, loading,
    criticalTasks, onSelectMultipleCriticalTaskPOs, scopeKind,
}: DNStepsProps) => {
    const isProject = scopeKind === "project";
    const facet = scopeFacet(scopeKind);
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
                    facetColumns={{ [facet.id]: facet.title, status: "Status" }}
                    dateFilterColumns={["creation", "latest_delivery_date"]}
                    searchPlaceholder={`Search by PO ID or ${facet.title}`}
                    emptyMessage={`No delivered POs found for this ${scopeKind}.`}
                />
            </CriticalTasksTab>

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select DNs to download" : `Download ${selectedIds.length} DN${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
