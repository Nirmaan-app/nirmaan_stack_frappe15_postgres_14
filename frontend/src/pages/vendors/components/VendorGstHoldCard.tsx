import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useFrappePostCall } from "frappe-react-sdk";
import { ShieldAlert } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { amountOverLimit, fyLabel, rupees, useVendorGstHold } from "@/hooks/useVendorGstHold";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";

/** GST is 18% on a Work Order (`ServiceRequests.calculate_total_amount`). */
const GST_RATE = 0.18;
/** Only these WOs are switched; the server skips the rest (`api/vendor/gst_hold.SWITCHABLE_STATUS`). */
const SWITCHABLE_STATUS = "Approved";

const AMOUNT_CELL = "whitespace-nowrap text-right tabular-nums";
const GST_ADD_TEXT = "text-amber-700 dark:text-amber-400";

interface VendorGstHoldCardProps {
    vendor: Vendors;
    mutateVendor: () => unknown;
    onEditVendor: () => void;
}

/**
 * GST Hold warning card for the Vendor page (ADR-0028). Renders nothing unless the vendor is on
 * GST Hold. Everyone sees the card; only an Admin gets "Remove GST Hold", and the server enforces it.
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
    const workOrders = summary?.work_orders ?? [];
    const toSwitch = workOrders.filter((wo) => wo.status === SWITCHABLE_STATUS);
    const gstToAdd = toSwitch.reduce((sum, wo) => sum + wo.total_amount * GST_RATE, 0);
    const totalPaid = workOrders.reduce((sum, wo) => sum + wo.amount_paid, 0);
    const over = summary ? amountOverLimit(summary) : 0;

    const handleApprove = async () => {
        try {
            const res = await call({ vendor: vendor.name });
            const switched: string[] = res?.message?.switched ?? [];
            const skipped: string[] = res?.message?.skipped ?? [];
            toast({
                title: "GST Hold removed",
                description:
                    `GST Applicable switched ON for ${switched.length} Work Order(s).` +
                    (skipped.length ? ` Skipped (not Approved): ${skipped.join(", ")}.` : ""),
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
                <AlertDialogContent className="sm:max-w-4xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove GST Hold</AlertDialogTitle>
                        <AlertDialogDescription>
                            {!hasGstNumber
                                ? "Add this vendor's GST number first to remove GST Hold."
                                : toSwitch.length > 0
                                    ? `Approving will switch GST Applicable ON for these ${toSwitch.length} Work Order(s) (adds ${rupees(gstToAdd)} GST to what is payable) and remove GST Hold.`
                                    : "This vendor has no GST-off Work Orders to switch this financial year. Approving will remove GST Hold."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {hasGstNumber && workOrders.length > 0 && (
                        <div className="max-h-[55vh] overflow-auto rounded-md border">
                            <Table>
                                {/* Header and footer stay pinned while the rows scroll. */}
                                <TableHeader className="sticky top-0 z-10 bg-muted">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="whitespace-nowrap">Work Order</TableHead>
                                        <TableHead>Project</TableHead>
                                        <TableHead className="whitespace-nowrap">Date</TableHead>
                                        <TableHead className="whitespace-nowrap text-right">WO Total</TableHead>
                                        <TableHead className="whitespace-nowrap text-right">GST to add (18%)</TableHead>
                                        <TableHead className="whitespace-nowrap text-right">Paid</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {workOrders.map((wo) => {
                                        const skipped = wo.status !== SWITCHABLE_STATUS;
                                        const project = wo.project_name || wo.project;
                                        return (
                                            <TableRow key={wo.name} className={cn(skipped && "text-muted-foreground")}>
                                                <TableCell className="whitespace-nowrap">
                                                    <Link to={`/service-requests/${wo.name}?tab=approved-sr`} className="text-blue-600 underline-offset-2 hover:underline">
                                                        {wo.name}
                                                    </Link>
                                                    {skipped && <div className="text-xs font-normal">Skipped — {wo.status}</div>}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="max-w-[200px] truncate" title={project}>{project}</div>
                                                </TableCell>
                                                <TableCell className="whitespace-nowrap font-normal text-muted-foreground">{formatDate(wo.creation)}</TableCell>
                                                <TableCell className={AMOUNT_CELL}>{rupees(wo.total_amount)}</TableCell>
                                                <TableCell className={cn(AMOUNT_CELL, !skipped && GST_ADD_TEXT)}>
                                                    {skipped ? "—" : `+${rupees(wo.total_amount * GST_RATE)}`}
                                                </TableCell>
                                                <TableCell className={AMOUNT_CELL}>{rupees(wo.amount_paid)}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                                <TableFooter className="sticky bottom-0 bg-muted">
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={3} className="font-semibold">
                                            Total <span className="font-normal text-muted-foreground">· {workOrders.length} Work Order(s)</span>
                                        </TableCell>
                                        <TableCell className={cn(AMOUNT_CELL, "font-semibold")}>{rupees(summary?.total ?? 0)}</TableCell>
                                        <TableCell className={cn(AMOUNT_CELL, "font-semibold", GST_ADD_TEXT)}>+{rupees(gstToAdd)}</TableCell>
                                        <TableCell className={cn(AMOUNT_CELL, "font-semibold")}>{rupees(totalPaid)}</TableCell>
                                    </TableRow>
                                </TableFooter>
                            </Table>
                        </div>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                        {hasGstNumber ? (
                            <Button onClick={handleApprove} disabled={loading || !summary}>
                                {loading ? <TailSpin color="white" height={20} width={20} /> : "Approve"}
                            </Button>
                        ) : (
                            <Button
                                onClick={() => {
                                    setDialogOpen(false);
                                    onEditVendor();
                                }}
                            >
                                Edit Vendor
                            </Button>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default VendorGstHoldCard;
