/**
 * Approve selected / Reject selected on an approval tab (ADR-0040 Amendment C point 5), as Project Payments' bulk
 * confirm reads (`approve-payments/components/BulkConfirmDialog.tsx`): the count and total, the people at or above
 * the monthly limit (information only, no tick: `BulkMonthLimitBox`), and the claims grouped by the tab approving
 * moves them to. A reject takes ONE reason for every claim. Amounts can't be changed in bulk.
 *
 * The groups are what the screen expects; the server decides each claim (a person's second claim in the batch counts
 * the first) and the toast says where each really went.
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { BulkMonthLimitBox } from "@/components/reimbursements/BulkMonthLimit";
import { useMonthTotals } from "@/components/reimbursements/useMonthTotals";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import type { RaiserLevel } from "@/utils/approvalTiers";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { landingTab, withBatchTotals, type ApprovalStage } from "@/utils/reimbursements/monthLimit";
import { TAB_CEO, TAB_LABELS, TAB_PENDING, type ReimbursementTab } from "@/utils/reimbursements/rules";

import type { Decision } from "./DecisionDialog";
import { useClaimDecisions, type DecisionOutcome } from "../hooks/useClaimDecisions";

interface Props {
    open: boolean;
    decision: Decision | null;
    stage: ApprovalStage;
    rows: readonly ClaimRow[];
    claimantName: (row: ClaimRow) => string;
    deciderLevel: RaiserLevel | null;
    onOpenChange: (open: boolean) => void;
    onDone: (outcome: DecisionOutcome) => void;
}

export function BulkDecisionDialog({ open, decision, stage, rows, claimantName, deciderLevel, onOpenChange, onDone }: Props) {
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const { approve, reject, busy } = useClaimDecisions();

    const approving = open && decision === "approve";
    const showsMonth = approving && stage !== TAB_CEO;
    const month = useMonthTotals(showsMonth ? { claims: rows.map((r) => r.name) } : null);
    const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    // On Pending Approval a person's later claim counts the earlier ones approved just before it (the server decides
    // in name order); on Pending L1 Approval they are all approved already, so each total already counts the others.
    const totals = useMemo(
        () => (stage === TAB_PENDING ? withBatchTotals(month.rows) : month.byClaim),
        [stage, month.rows, month.byClaim],
    );

    // Approving: the claims by the tab they are expected to land in ("Not known yet" for HR until the totals load).
    const groups = useMemo(() => {
        if (!approving) return [];
        const byTab = new Map<ReimbursementTab | "unknown", ClaimRow[]>();
        for (const row of rows) {
            const monthRow = totals.get(row.name);
            const tab = landingTab(stage, Number(row.amount) || 0, monthRow ? monthRow.month_total : null, deciderLevel) ?? "unknown";
            byTab.set(tab, [...(byTab.get(tab) ?? []), row]);
        }
        return [...byTab.entries()];
    }, [approving, rows, totals, stage, deciderLevel]);

    const close = (next: boolean) => {
        if (busy) return;
        if (!next) {
            setReason("");
            setError(null);
        }
        onOpenChange(next);
    };

    const confirm = async () => {
        if (!decision || rows.length === 0) return;
        if (decision === "reject" && !reason.trim()) {
            setError("Write a reason. Every claimant in this selection sees it.");
            return;
        }
        try {
            // The bulk confirm is the acknowledgement: the box above named everyone at or above the limit.
            const outcome = decision === "approve"
                ? await approve(stage, rows, { acknowledged: true, isCeo: deciderLevel === "ceo" })
                : await reject(stage, rows, reason.trim());
            setReason("");
            setError(null);
            onOpenChange(false);
            onDone(outcome);
        } catch (e) {
            setError(getFrappeError(e));
        }
    };

    const noun = rows.length === 1 ? "claim" : "claims";
    return (
        <AlertDialog open={open && !!decision} onOpenChange={close}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {decision === "approve" ? "Approve" : "Reject"} {rows.length} {noun}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {TAB_LABELS[stage]} · Total <span className="font-semibold text-foreground">{formatToRoundedIndianRupee(total)}</span>.{" "}
                        {decision === "approve"
                            ? "Each claim is approved for its full amount: amounts can't be changed in bulk."
                            : "Rejection is final. Every claimant sees the one reason below."}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {showsMonth && totals.size > 0 && <BulkMonthLimitBox rows={[...totals.values()]} />}
                {showsMonth && month.failed && (
                    <p className="text-xs text-amber-800">The month totals couldn't be read. The server still checks each claim.</p>
                )}

                {approving ? (
                    <div className="max-h-64 space-y-3 overflow-y-auto">
                        {groups.map(([tab, group]) => (
                            <section key={tab}>
                                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {tab === "unknown" ? "Where it goes is worked out when approved" : `Goes to ${TAB_LABELS[tab]}`} · {group.length}
                                </h4>
                                <ClaimList rows={group} claimantName={claimantName} />
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="max-h-48 overflow-y-auto"><ClaimList rows={rows} claimantName={claimantName} /></div>
                )}

                {decision === "reject" && (
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reimb-bulk-reason">Reason for all {rows.length} <span className="text-destructive">*</span></Label>
                        <Textarea id="reimb-bulk-reason" rows={3} value={reason} disabled={busy}
                            placeholder="e.g. Duplicate claims. Please raise one claim with every receipt."
                            onChange={(e) => { setReason(e.target.value); setError(null); }} />
                    </div>
                )}
                {stage === TAB_PENDING && decision === "approve" && (
                    <p className="text-[11px] text-muted-foreground">A person's claims are approved one after the other, so a later one counts the earlier ones.</p>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <Button onClick={confirm} disabled={busy || (showsMonth && month.isLoading)}
                        variant={decision === "reject" ? "destructive" : "default"}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {decision === "approve" ? `Approve ${rows.length} ${noun}` : `Reject ${rows.length} ${noun}`}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

function ClaimList({ rows, claimantName }: { rows: readonly ClaimRow[]; claimantName: (row: ClaimRow) => string }) {
    return (
        <ul className="divide-y rounded-md border text-sm">
            {rows.map((r) => (
                <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-1.5">
                    <span className="truncate">
                        <span className="font-mono text-xs text-muted-foreground">{r.name}</span> · {claimantName(r)}
                        <span className="block truncate text-xs text-muted-foreground">{r.title}</span>
                    </span>
                    <span className="self-center font-medium tabular-nums">{formatToIndianRupee(r.amount)}</span>
                </li>
            ))}
        </ul>
    );
}
