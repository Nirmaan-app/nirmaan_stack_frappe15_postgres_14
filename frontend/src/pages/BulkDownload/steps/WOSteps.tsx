/**
 * WOSteps — Work Order selection table with facet / date filters + select all
 */
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { woColumns } from "./bulkTableColumns";
import { WOItem } from "../useBulkDownloadWizard";
import { useUserData } from "@/hooks/useUserData";

interface WOStepsProps {
    items: WOItem[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    withRate: boolean;
    onWithRateChange: (v: boolean) => void;
}

export const WOSteps = ({
    items, isLoading, selectedIds, onSelectAll,
    onBack, onDownload, loading,
    withRate, onWithRateChange,
}: WOStepsProps) => {
    const { role } = useUserData();
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
                columns={woColumns}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onSelectedIdsChange={onSelectAll}
                facetColumns={{ vendor: "Vendor" }}
                dateFilterColumns={["creation"]}
                searchPlaceholder="Search by WO ID or Vendor"
                emptyMessage="No Work Orders found for this project."
            />

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-40">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select WOs to download" : `Download ${selectedIds.length} WO${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
