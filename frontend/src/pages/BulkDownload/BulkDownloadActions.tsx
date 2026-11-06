/**
 * BulkDownloadActions — the one Back / Download row of the wizard's selection step, rendered by
 * BulkDownloadPage for every type and scope (the steps have no footer of their own).
 *
 * Reports > Bulk Download (the all scope) puts it at the TOP, with the over-limit warning right under
 * it (owner, 2026-10-28); the project and vendor tabs keep it at the bottom. The rules are the same in
 * both places: Download is disabled while generating, with nothing ticked, or over the selection limit.
 */
import { AlertTriangle, ArrowLeft, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BulkDownloadActionsProps {
    /** How many items are ticked -- what Download posts. */
    count: number;
    /** The type's short plural ("POs", "Client Invoices"); the label singularises it for one. */
    plural: string;
    loading: boolean;
    /** True when `count` is over `maxSelect` (the all scope's cap; the project and vendor tabs have none). */
    overLimit: boolean;
    maxSelect?: number;
    placement: "top" | "bottom";
    onBack: () => void;
    onDownload: () => void;
}

export const BulkDownloadActions = ({
    count, plural, loading, overLimit, maxSelect, placement, onBack, onDownload,
}: BulkDownloadActionsProps) => {
    const noun = count === 1 ? plural.replace(/s$/, "") : plural;
    const canDownload = count > 0 && !overLimit;
    return (
        <div className={cn("flex flex-col gap-3", placement === "top" ? "mb-4" : "mt-4 pt-2")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                    variant={placement === "top" ? "destructive" : "ghost"}
                    size={placement === "top" ? "sm" : "default"}
                    onClick={onBack}
                    disabled={loading}
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button
                    onClick={onDownload}
                    disabled={loading || !canDownload}
                    variant={canDownload ? "destructive" : "outline"}
                    className="min-w-44"
                >
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading
                        ? "Generating..."
                        : count === 0
                            ? `Select ${plural} to download`
                            : `Download ${count.toLocaleString("en-IN")} ${noun}`}
                </Button>
            </div>
            {overLimit && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                        {count.toLocaleString("en-IN")} selected. One download takes up to {maxSelect?.toLocaleString("en-IN")}.
                        Narrow the list with the Project, Vendor or Date filters.
                    </span>
                </div>
            )}
        </div>
    );
};
