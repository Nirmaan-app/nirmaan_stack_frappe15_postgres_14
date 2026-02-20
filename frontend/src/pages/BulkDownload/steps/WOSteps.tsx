/**
 * WOSteps — simple Work Order selection list
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { WOItem } from "../useBulkDownloadWizard";

interface WOStepsProps {
    items: WOItem[];
    isLoading: boolean;
    selectedIds: string[];
    onToggle: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onDeselectAll: () => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
}

export const WOSteps = ({
    items, isLoading, selectedIds, onToggle, onSelectAll, onDeselectAll,
    onBack, onDownload, loading,
}: WOStepsProps) => {
    const baseItems: BaseItem[] = items.map((wo) => ({
        name: wo.name,
        subtitle: wo.vendor || "—",
        status: wo.status,
        dateStr: formatCreationDate(wo.creation),
    }));

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Work Orders</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
                </p>
            </div>

            <BaseItemList
                items={baseItems}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onToggle={onToggle}
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
