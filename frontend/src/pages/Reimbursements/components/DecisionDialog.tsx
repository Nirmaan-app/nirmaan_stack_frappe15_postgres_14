/**
 * Approve (the full amount) or Reject (with a reason) one claim, showing what is being decided: who claims
 * it, how much, and the account it will be paid into. The server decides who may (`api/reimbursements/
 * review.py`); this dialog only opens from rows the server put in the person's Pending Approval queue.
 */

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

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

export type Decision = "approve" | "reject";

const APPROVE_API = "nirmaan_stack.api.reimbursements.review.approve_reimbursement";
const REJECT_API = "nirmaan_stack.api.reimbursements.review.reject_reimbursement";

interface Props {
    decision: Decision | null;
    claim: Reimbursement | null;
    claimantName: string;
    isOwn: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}

export function DecisionDialog({ decision, claim, claimantName, isOwn, onOpenChange, onDone }: Props) {
    const { toast } = useToast();
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const { call: approve, loading: approving } = useFrappePostCall(APPROVE_API);
    const { call: reject, loading: rejecting } = useFrappePostCall(REJECT_API);
    const busy = approving || rejecting;
    const open = !!decision && !!claim;

    const close = (next: boolean) => {
        if (!next) {
            setReason("");
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
            if (decision === "approve") await approve({ name: claim.name });
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
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={close}>
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
                    <Button onClick={confirm} disabled={busy} variant={decision === "reject" ? "destructive" : "default"}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {decision === "approve" ? `Approve ${claim ? formatToIndianRupee(claim.amount) : ""}` : "Reject claim"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
