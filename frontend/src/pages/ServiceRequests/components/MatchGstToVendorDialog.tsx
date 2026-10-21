import React from "react";
import { TailSpin } from "react-loader-spinner";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { useMatchGstPreview, useMatchGstToVendor } from "../hooks/useMatchGstToVendor";

interface MatchGstToVendorDialogProps {
    /** The Work Order to match; `null` keeps the dialog closed. */
    workOrder: string | null;
    onClose: () => void;
    /** Called after a successful match, to refetch whatever shows the Work Order. */
    onMatched: () => unknown;
}

const onOff = (gst: string) => (gst === "true" ? "On" : "Off");

/**
 * Match GST to vendor (ADR-0028 Amendment A): shows what setting the Work Order's GST flag from its
 * vendor does to its total and Amount Due, and applies it on confirm. The server re-checks everything.
 */
export const MatchGstToVendorDialog: React.FC<MatchGstToVendorDialogProps> = ({ workOrder, onClose, onMatched }) => {
    const { preview, isLoading, error } = useMatchGstPreview(workOrder);
    const { match, loading } = useMatchGstToVendor();

    const blocked = (preview?.blocked_by.length ?? 0) > 0;
    const canApply = !!preview && !preview.matches && !blocked && preview.status === "Approved";

    const handleApply = async () => {
        if (!workOrder) return;
        try {
            const after = await match(workOrder);
            toast({
                title: "GST matched to vendor",
                description: `${workOrder}: GST ${onOff(after.gst)}. Total ${formatToIndianRupeeOrZero(after.total_before)}, Amount Due ${formatToIndianRupeeOrZero(after.amount_due_before)}.`,
                variant: "success",
            });
            await onMatched();
            onClose();
        } catch (err) {
            toast({ title: "Could not match GST", description: getFrappeError(err), variant: "destructive" });
        }
    };

    const rows: [string, string, string][] = preview
        ? [
            ["GST Applicable", onOff(preview.gst), onOff(preview.target_gst)],
            ["Total", formatToIndianRupeeOrZero(preview.total_before), formatToIndianRupeeOrZero(preview.total_after)],
            ["Amount Paid", formatToIndianRupeeOrZero(preview.amount_paid), formatToIndianRupeeOrZero(preview.amount_paid)],
            ["Amount Due", formatToIndianRupeeOrZero(preview.amount_due_before), formatToIndianRupeeOrZero(preview.amount_due_after)],
        ]
        : [];

    return (
        <Dialog open={!!workOrder} onOpenChange={(open) => !open && !loading && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Match GST to vendor</DialogTitle>
                    <DialogDescription>
                        {preview
                            ? `${preview.work_order} · ${preview.vendor_name || preview.vendor} ${preview.vendor_gst ? `has GST number ${preview.vendor_gst}` : "has no GST number"}.`
                            : workOrder}
                    </DialogDescription>
                </DialogHeader>

                {isLoading && (
                    <div className="flex justify-center py-6"><TailSpin height={28} width={28} color="red" /></div>
                )}
                {error && <p className="text-sm text-destructive">{getFrappeError(error)}</p>}

                {preview && (
                    <div className="space-y-3 text-sm">
                        <table className="w-full" data-testid="match-gst-preview">
                            <thead>
                                <tr className="text-left text-xs text-muted-foreground">
                                    <th className="py-1 font-medium" />
                                    <th className="py-1 text-right font-medium">Now</th>
                                    <th className="py-1 text-right font-medium">After</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(([label, now, after]) => (
                                    <tr key={label} className="border-t">
                                        <td className="py-1.5">{label}</td>
                                        <td className="py-1.5 text-right tabular-nums">{now}</td>
                                        <td className={`py-1.5 text-right tabular-nums ${now !== after ? "font-semibold" : ""}`}>{after}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {preview.is_finalized === 1 && (
                            <p className="text-xs text-muted-foreground">This Work Order is finalized. Matching GST still changes its total.</p>
                        )}
                        {preview.matches && <p className="text-muted-foreground">GST already matches the vendor. Nothing to change.</p>}
                        {blocked && (
                            <p className="text-destructive">
                                GST can't be switched off while this Work Order has GST payments: {preview.blocked_by.join(", ")}.
                            </p>
                        )}
                        {!preview.matches && preview.status !== "Approved" && (
                            <p className="text-destructive">Only an Approved Work Order can be matched; this one is {preview.status}.</p>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button onClick={handleApply} disabled={!canApply || loading}>
                        {loading ? <TailSpin color="white" height={18} width={18} /> : `Set GST ${preview ? onOff(preview.target_gst) : ""}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
