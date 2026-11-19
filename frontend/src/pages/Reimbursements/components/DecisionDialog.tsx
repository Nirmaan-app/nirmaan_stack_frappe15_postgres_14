/**
 * Approve (the full amount) or Reject (with a reason) one claim on an approval tab, showing what is being decided:
 * who claims it, how much, the account it will be paid into, and the tab approving moves it to ("Goes to"). The
 * server decides who may (`useClaimDecisions`); this dialog only opens from rows the person may act on.
 *
 * On Pending Approval and Pending L1 Approval it shows the claimant's month total (ADR-0040 Amendment B): at or
 * above the ₹2,000 monthly limit the approver ticks the warning first. On Pending Approval the tick is sent as
 * `acknowledged` (the server refuses an unticked one).
 */

import { useState } from "react";
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
import type { ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import type { RaiserLevel } from "@/utils/approvalTiers";
import { approvalLanding, type ApprovalStage } from "@/utils/reimbursements/monthLimit";
import { TAB_CEO, TAB_LABELS, TAB_PENDING, approvalNeedsL1 } from "@/utils/reimbursements/rules";

import type { DecisionOutcome } from "../hooks/useClaimDecisions";
import { useClaimDecisions } from "../hooks/useClaimDecisions";

export type Decision = "approve" | "reject";

interface Props {
    open: boolean;
    /** Kept by the page after closing, so the dialog still shows it while it animates out. */
    decision: Decision | null;
    stage: ApprovalStage;
    claim: ClaimRow | null;
    claimantName: string;
    isOwn: boolean;
    /** The approver's level (`approvalTiers.raiserLevelOf`): Admin is L1, the CEO clears both; null for HR. */
    deciderLevel: RaiserLevel | null;
    onOpenChange: (open: boolean) => void;
    /** After the server answered with the claim moved. */
    onDone: (outcome: DecisionOutcome) => void;
}

export function DecisionDialog({
    open, decision, stage, claim, claimantName, isOwn, deciderLevel, onOpenChange, onDone,
}: Props) {
    const [reason, setReason] = useState("");
    const [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { approve, reject, busy } = useClaimDecisions();

    const approving = open && decision === "approve" && !!claim;
    // The CEO's tab is past the monthly limit's step: the box shows on the two tabs where it decides anything.
    const showsMonth = approving && stage !== TAB_CEO;
    const month = useMonthTotals(showsMonth && claim ? { claims: [claim.name] } : null);
    const monthRow = showsMonth && claim ? month.byClaim.get(claim.name) : undefined;
    const landing = approving && claim
        ? approvalLanding(claim.amount, monthRow ? monthRow.month_total : null, deciderLevel, stage)
        : null;
    const waitsForTick = showsMonth && (month.isLoading || (monthTickNeeded(monthRow, month.failed) && !acknowledged));

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
            const outcome = decision === "approve"
                ? await approve(stage, [claim], { acknowledged, isCeo: deciderLevel === "ceo" })
                : await reject(stage, [claim], reason.trim());
            const refused = outcome.failed.find((f) => f.claim === claim.name);
            if (refused && !outcome.moved.some((m) => m.claim === claim.name)) {
                setError(refused.reason);
                // The month may have moved on since the dialog opened: read it again, so a refusal for a missing
                // tick shows the box to tick.
                if (showsMonth) month.refresh();
                return;
            }
            close(false);
            onDone(outcome);
        } catch (e) {
            setError(getFrappeError(e));
        }
    };

    return (
        <AlertDialog open={open && !!decision && !!claim} onOpenChange={close}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>{decision === "approve" ? "Approve" : "Reject"} {claim?.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {decision === "approve"
                            ? `${TAB_LABELS[stage]}. The full amount is approved. To change the amount, reject it and the claimant raises a new claim.`
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
                        {stage !== TAB_PENDING && claim.expense && (
                            <>
                                <dt className="text-muted-foreground">Expense</dt>
                                <dd className="font-mono text-xs">{claim.expense}</dd>
                            </>
                        )}
                        <dt className="text-muted-foreground">Pay to</dt>
                        <dd className="break-words">
                            {claim.pay_to_account_name} · {claim.pay_to_bank_name}{" "}
                            <span className="font-mono">{claim.pay_to_account_number}</span>
                        </dd>
                    </dl>
                )}
                {showsMonth && (
                    <MonthLimitNotice
                        row={monthRow}
                        isLoading={month.isLoading}
                        failed={month.failed}
                        place="decide"
                        goesToL1={stage === TAB_PENDING && !!monthRow && approvalNeedsL1(monthRow.month_total, deciderLevel !== null)}
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
                    <Button onClick={confirm} disabled={busy || (decision === "approve" && waitsForTick)}
                        variant={decision === "reject" ? "destructive" : "default"}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {decision === "approve" ? `Approve ${claim ? formatToIndianRupee(claim.amount) : ""}` : "Reject claim"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
