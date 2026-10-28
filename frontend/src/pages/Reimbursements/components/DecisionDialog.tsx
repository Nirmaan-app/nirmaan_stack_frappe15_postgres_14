/**
 * Approve (the full amount) or Reject (with a reason) one claim, showing what is being decided: who claims
 * it, how much, and the account it will be paid into. The server decides who may (`api/reimbursements/
 * review.py`); this dialog only opens from rows the server put in the person's Pending Approval queue.
 *
 * Approving shows the claimant's month total (ADR-0040 Amendment B): above the ₹2,000 monthly limit the approver
 * ticks the warning first, and the tick is sent as `acknowledged` (the server refuses an unticked one).
 */

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { ArrowRight, Loader2 } from "lucide-react";

import { MonthLimitNotice, monthTickNeeded } from "@/components/reimbursements/MonthLimitNotice";
import { useMonthTotals } from "@/components/reimbursements/useMonthTotals";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import type { Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import type { RaiserLevel } from "@/utils/approvalTiers";
import { approvalLanding } from "@/utils/reimbursements/monthLimit";
import { approvalNeedsL1 } from "@/utils/reimbursements/rules";

export type Decision = "approve" | "reject";

const APPROVE_API = "nirmaan_stack.api.reimbursements.review.approve_reimbursement";
const REJECT_API = "nirmaan_stack.api.reimbursements.review.reject_reimbursement";

interface Props {
    open: boolean;
    /** Kept by the page after closing, so the dialog still shows it while it animates out. */
    decision: Decision | null;
    claim: Reimbursement | null;
    claimantName: string;
    isOwn: boolean;
    /** The approver's level (`approvalTiers.raiserLevelOf`): Admin is L1, the CEO clears both; null for HR. */
    deciderLevel: RaiserLevel | null;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

export function DecisionDialog({ open, decision, claim, claimantName, isOwn, deciderLevel, onOpenChange, onDone }: Props) {
    const { toast } = useToast();
    const [reason, setReason] = useState("");
    const [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { call: approve, loading: approving } = useFrappePostCall(APPROVE_API);
    const { call: reject, loading: rejecting } = useFrappePostCall(REJECT_API);
    const busy = approving || rejecting;

    const approvingClaim = open && decision === "approve" && claim ? claim.name : null;
    const month = useMonthTotals(approvingClaim ? { claims: [approvingClaim] } : null);
    const monthRow = approvingClaim ? month.byClaim.get(approvingClaim) : undefined;
    // Where approving puts the claim's expense in Project Payments (owner, 2026-10-28).
    const landing = decision === "approve" && claim
        ? approvalLanding(claim.amount, monthRow ? monthRow.month_total : null, deciderLevel)
        : null;
    const waitsForTick = decision === "approve"
        && (month.isLoading || (monthTickNeeded(monthRow, month.failed) && !acknowledged));

    const close = (next: boolean) => {
        if (!next) {
            setReason("");
            setAcknowledged(false);
            setError(null);
        }
        onOpenChange(next);
    };

    const confirm = async () => {
        if (!claim || !decision) return;
        if (decision === "reject" && !reason.trim()) {
            setError("Write a reason. The person who raised the claim sees it.");
            return;
        }
        try {
            if (decision === "approve") await approve({ name: claim.name, acknowledged: acknowledged ? 1 : 0 });
            else await reject({ name: claim.name, reason: reason.trim() });
            toast({
                title: decision === "approve" ? `Approved ${claim.name}` : `Rejected ${claim.name}`,
                description: isOwn ? undefined : `${claimantName} has been notified.`,
                variant: "success",
            });
            close(false);
            onDone();
        } catch (e) {
            setError(getFrappeError(e));
            // The month may have moved on since the dialog opened (another of this person's claims approved in
            // another window): read the total again, so a refusal for a missing tick shows the box to tick.
            if (decision === "approve") month.refresh();
        }
    };

    return (
        <AlertDialog open={open && !!decision && !!claim} onOpenChange={close}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>{decision === "approve" ? "Approve" : "Reject"} {claim?.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {decision === "approve"
                            ? "The full amount is approved. To change the amount, reject it and the claimant raises a new claim."
                            : "Rejection is final. The claimant sees your reason and can delete the claim and raise a new one."}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {claim && (
                    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-muted/50 p-3 text-sm">
                        <dt className="text-muted-foreground">Claimant</dt>
                        <dd>{claimantName}{isOwn ? " (you)" : ""}</dd>
                        <dt className="text-muted-foreground">Title</dt>
                        <dd className="break-words">{claim.title}</dd>
                        <dt className="text-muted-foreground">Amount</dt>
                        <dd className="font-semibold tabular-nums">{formatToIndianRupee(claim.amount)}</dd>
                        <dt className="text-muted-foreground">Pay to</dt>
                        <dd className="break-words">
                            {claim.pay_to_account_name} · {claim.pay_to_bank_name}{" "}
                            <span className="font-mono">{claim.pay_to_account_number}</span>
                        </dd>
                    </dl>
                )}
                {decision === "approve" && (
                    <MonthLimitNotice
                        row={monthRow}
                        isLoading={month.isLoading}
                        failed={month.failed}
                        place="decide"
                        goesToL1={!!monthRow && approvalNeedsL1(monthRow.month_total, deciderLevel !== null)}
                        acknowledged={acknowledged}
                        onAcknowledgedChange={(v) => { setAcknowledged(v); setError(null); }}
                        disabled={busy}
                    />
                )}
                {landing && (
                    <p className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
                        <span>{landing}</span>
                    </p>
                )}
                {decision === "reject" && (
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reimb-reject-reason">Reason <span className="text-destructive">*</span></Label>
                        <Textarea id="reimb-reject-reason" rows={3} value={reason} disabled={busy}
                            placeholder="e.g. The receipt is unreadable. Please raise it again with a clear photo."
                            onChange={(e) => { setReason(e.target.value); setError(null); }} />
                    </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <Button onClick={confirm} disabled={busy || waitsForTick} variant={decision === "reject" ? "destructive" : "default"}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {decision === "approve" ? `Approve ${claim ? formatToIndianRupee(claim.amount) : ""}` : "Reject claim"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
