import React, { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Info } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import {
    TDS_CUT_UNDO_ENDPOINTS, TDS_CUT_UNDO_LABELS, canMarkAsDeposit, canUndoTdsCut, tdsCutUndoConfirmText, tdsCutUndoHelp,
    type TdsCutUndoAction, type TdsCutUndoDeduction, type TdsCutUndoPayment,
} from "./tdsCutUndo";

interface TdsCutUndoActionsProps {
    payment: TdsCutUndoPayment;
    /** The payment's recorded deduction (`get_work_order_tds` payments), if any. */
    deduction?: TdsCutUndoDeduction;
    /** Admin only: the server checks it again. */
    isAdmin: boolean;
    /** Called after a successful action, to refetch the Work Order and its payments. */
    onDone: () => unknown;
}

/** The ⓘ beside a button: what the action does, with this payment's own figures. */
const ActionHelp: React.FC<{ action: TdsCutUndoAction; payment: TdsCutUndoPayment; deduction: TdsCutUndoDeduction }> = ({
    action, payment, deduction,
}) => {
    const help = tdsCutUndoHelp(action, payment, deduction);
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={`What ${TDS_CUT_UNDO_LABELS[action]} does`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Info className="h-3.5 w-3.5" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="max-w-xs text-left">
                <p className="font-semibold">{TDS_CUT_UNDO_LABELS[action]}</p>
                <p className="mt-1">{help.headline}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {help.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
            </TooltipContent>
        </Tooltip>
    );
};

/**
 * *Company Bears TDS* and *Mark as Deposit* (owner 2026-10-27). On a payment cut by its TDS, before it is
 * paid, both put it back to its full request: the first keeps the TDS as the company's, the second deletes
 * it. On a TDS the company already bears, *Mark as Deposit* alone, deleting it. Shown by `canUndoTdsCut` /
 * `canMarkAsDeposit`; the server refuses the rest, a TDS already paid included (`services/tds_cut_undo`).
 */
export const TdsCutUndoActions: React.FC<TdsCutUndoActionsProps> = ({ payment, deduction, isAdmin, onDone }) => {
    const [open, setOpen] = useState<TdsCutUndoAction | null>(null);
    const company = useFrappePostCall<{ message: { amount: number } }>(TDS_CUT_UNDO_ENDPOINTS.company);
    const deposit = useFrappePostCall<{ message: { amount: number } }>(TDS_CUT_UNDO_ENDPOINTS.deposit);
    const loading = company.loading || deposit.loading;

    const showCompany = canUndoTdsCut(payment, deduction, isAdmin);
    const showDeposit = canMarkAsDeposit(payment, deduction, isAdmin);
    if (!deduction || !(showCompany || showDeposit)) return null;

    const handleConfirm = async () => {
        if (!open) return;
        const label = TDS_CUT_UNDO_LABELS[open];
        try {
            const { message } = await (open === "company" ? company : deposit).call({ payment: payment.name });
            toast({
                title: label,
                description: open === "deposit"
                    ? `${payment.name}: TDS removed. The vendor's amount is ${formatToIndianRupeeOrZero(message.amount)}.`
                    : `${payment.name}: the vendor will be paid ${formatToIndianRupeeOrZero(message.amount)}.`,
                variant: "success",
            });
        } catch (err) {
            toast({ title: `Could not use ${label}`, description: getFrappeError(err), variant: "destructive" });
        }
        // Closed at once, so the saved action can't be confirmed twice while the table reloads; reloaded
        // after a refusal too, as one usually means this page is stale (the action was already used).
        setOpen(null);
        await onDone();
    };

    return (
        <TooltipProvider delayDuration={150}>
            <div className="flex flex-wrap items-center justify-end gap-1">
                {showCompany && <span className="inline-flex items-center gap-0.5">
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs text-foreground" onClick={() => setOpen("company")}>
                        {TDS_CUT_UNDO_LABELS.company}
                    </Button>
                    <ActionHelp action="company" payment={payment} deduction={deduction} />
                </span>}
                {showDeposit && <span className="inline-flex items-center gap-0.5">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-6 border-destructive/50 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setOpen("deposit")}
                    >
                        {TDS_CUT_UNDO_LABELS.deposit}
                    </Button>
                    <ActionHelp action="deposit" payment={payment} deduction={deduction} />
                </span>}
            </div>
            <Dialog open={open !== null} onOpenChange={(next) => !loading && !next && setOpen(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{open ? TDS_CUT_UNDO_LABELS[open] : ""}</DialogTitle>
                        <DialogDescription>{payment.name}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 text-sm text-foreground">
                        <p>{open ? tdsCutUndoConfirmText(open, payment, deduction) : ""}</p>
                        {open === "deposit" && (
                            <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                                No TDS will be deposited for this payment, and it won't appear in the TDS register.
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(null)} disabled={loading}>Cancel</Button>
                        <Button variant={open === "deposit" ? "destructive" : "default"} onClick={handleConfirm} disabled={loading}>
                            {loading ? "Saving…" : open ? TDS_CUT_UNDO_LABELS[open] : ""}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
};
