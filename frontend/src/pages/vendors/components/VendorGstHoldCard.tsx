import React, { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { ShieldAlert } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { amountOverLimit, fyLabel, rupees, useVendorGstHold } from "@/hooks/useVendorGstHold";
import { Vendors } from "@/types/NirmaanStack/Vendors";

interface VendorGstHoldCardProps {
    vendor: Vendors;
    mutateVendor: () => unknown;
    onEditVendor: () => void;
}

/**
 * GST Hold warning card for the Vendor page (ADR-0028). Renders nothing unless the vendor is on
 * GST Hold. Everyone sees the card; only an Admin gets "Remove GST Hold", and the server enforces it.
 * Removing it changes no Work Order (ADR-0028 Amendment A): GST follows the vendor, and old GST-off
 * Work Orders go to accounts through the GST mismatch list (Match GST to vendor).
 *
 * NOT Vendor Hold (`vendor_status` On-Hold, the credit hold — `VendorHoldBanner`).
 */
export const VendorGstHoldCard: React.FC<VendorGstHoldCardProps> = ({ vendor, mutateVendor, onEditVendor }) => {
    const { role } = useUserData();
    const isAdmin = role === "Nirmaan Admin Profile";
    const [dialogOpen, setDialogOpen] = useState(false);

    const { summary, mutate } = useVendorGstHold(vendor.gst_hold ? vendor.name : undefined);
    const { call, loading } = useFrappePostCall("nirmaan_stack.api.vendor.gst_hold.remove_gst_hold");

    if (!vendor.gst_hold) return null;

    const hasGstNumber = !!vendor.vendor_gst?.trim();
    const over = summary ? amountOverLimit(summary) : 0;

    const handleApprove = async () => {
        try {
            await call({ vendor: vendor.name });
            toast({
                title: "GST Hold removed",
                description: "No Work Order was changed.",
                variant: "success",
            });
            setDialogOpen(false);
            mutate();
            await mutateVendor();
        } catch (err: any) {
            toast({
                title: "Could not remove GST Hold",
                description: err?.message || "Please try again.",
                variant: "destructive",
            });
        }
    };

    return (
        <>
            <div
                role="alert"
                className="mx-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
            >
                <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">GST Hold</p>
                    {summary && (
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                            GST-off Work Orders in {fyLabel(summary)}:{" "}
                            <span className="font-semibold">{rupees(summary.total)}</span>
                            {" of "}{rupees(summary.limit)}
                            {over > 0 && (
                                <>
                                    {" · "}
                                    <span className="font-semibold text-red-700 dark:text-red-400">{rupees(over)} over</span>
                                </>
                            )}
                        </p>
                    )}
                </div>
                {isAdmin && (
                    <Button size="sm" variant="outline" className="border-amber-400" onClick={() => setDialogOpen(true)}>
                        Remove GST Hold
                    </Button>
                )}
            </div>

            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove GST Hold</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2">
                                <p>This only clears the hold. No Work Order changes.</p>
                                {hasGstNumber ? (
                                    <p>
                                        New Work Orders for this vendor are approved with GST on. Its GST-off Work
                                        Orders are listed under Work Orders → All WO → GST mismatch, for accounts to
                                        match one by one.
                                    </p>
                                ) : (
                                    <p>
                                        This vendor has no GST number. If it has registered, add the number first
                                        (Edit Vendor). If it is still over {summary ? rupees(summary.limit) : "the limit"},
                                        the next morning's check puts it back on hold.
                                    </p>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                        {!hasGstNumber && (
                            <Button
                                variant="outline"
                                disabled={loading}
                                onClick={() => {
                                    setDialogOpen(false);
                                    onEditVendor();
                                }}
                            >
                                Edit Vendor
                            </Button>
                        )}
                        <Button onClick={handleApprove} disabled={loading}>
                            {loading ? <TailSpin color="white" height={20} width={20} /> : "Remove GST Hold"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default VendorGstHoldCard;
