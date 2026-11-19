/**
 * Approve or reject claims on the three approval tabs (ADR-0040 Amendment C), one row or many through the same
 * calls, so the row button and Approve selected can't land a claim in different places:
 *
 * * Pending Approval -- `review.bulk_approve_reimbursements` / `bulk_reject_reimbursements` on the claims. Each
 *   claim is decided on its own (savepoint), and the reply names the tab it landed in.
 * * Pending L1 Approval / Pending CEO Approval -- Project Payments' one expense decision call (`decide_expenses`)
 *   on the claims' Non-Project Expenses: `l1_approve` / `ceo_approve` / `reject` with a reason. The claim follows
 *   its expense (`expense_link`). The CEO's approval on Pending L1 Approval ends at Payment need to be paid (owner,
 *   2026-11-18): when L1 leaves an expense at CEO Pending (above ₹50,000), the CEO step is sent straight after.
 *
 * Partial failure is normal: the outcome lists what moved (and where to) and what was refused, with the server's
 * reason. Who may decide is the server's; the screen only decides which buttons show.
 */

import { useCallback } from "react";
import { useFrappePostCall } from "@/lib/frappe";

import { useExpenseDecision } from "@/hooks/useExpenseDecision";
import type { BulkClaimsReply, ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import type { ApprovalStage } from "@/utils/reimbursements/monthLimit";
import {
    TAB_CEO,
    TAB_L1,
    TAB_PENDING,
    claimTab,
    type ReimbursementTab,
} from "@/utils/reimbursements/rules";

const BULK_APPROVE_API = "nirmaan_stack.api.reimbursements.review.bulk_approve_reimbursements";
const BULK_REJECT_API = "nirmaan_stack.api.reimbursements.review.bulk_reject_reimbursements";
const CEO_PENDING = "CEO Pending";

export interface DecisionOutcome {
    /** Each claim that moved, and the tab it is in now (null = only All: rejected). */
    moved: { claim: string; tab: ReimbursementTab | null }[];
    failed: { claim: string; reason: string }[];
}

interface Options {
    /** Pending Approval: the approver confirmed the monthly-limit box (the tick, or the bulk confirm). */
    acknowledged?: boolean;
    /** The approver is the CEO: an L1 approval goes on through the CEO step. */
    isCeo?: boolean;
}

export function useClaimDecisions() {
    const { call: bulkApprove, loading: approving } = useFrappePostCall<{ message: { data: BulkClaimsReply } }>(BULK_APPROVE_API);
    const { call: bulkReject, loading: rejecting } = useFrappePostCall<{ message: { data: BulkClaimsReply } }>(BULK_REJECT_API);
    const { decide, loading: deciding } = useExpenseDecision();

    const fromClaims = (data: BulkClaimsReply): DecisionOutcome => ({
        moved: data.succeeded.map((claim) => ({ claim, tab: data.results[claim]?.tab ?? null })),
        failed: data.failed.map((f) => ({ claim: f.name, reason: f.reason })),
    });

    /** The claims' expenses, and back. A row on an expense-led tab always has one. */
    const expensesOf = (rows: readonly ClaimRow[]) => {
        const claimOf = new Map<string, string>();
        for (const row of rows) if (row.expense) claimOf.set(row.expense, row.name);
        return { expenses: [...claimOf.keys()], claimOf };
    };

    const approve = useCallback(
        async (stage: ApprovalStage, rows: readonly ClaimRow[], options: Options = {}): Promise<DecisionOutcome> => {
            if (stage === TAB_PENDING) {
                const reply = await bulkApprove({
                    names: JSON.stringify(rows.map((r) => r.name)),
                    acknowledged: options.acknowledged ? 1 : 0,
                });
                return fromClaims(reply.message.data);
            }
            const { expenses, claimOf } = expensesOf(rows);
            const first = await decide(expenses, stage === TAB_CEO ? "ceo_approve" : "l1_approve");
            const statuses = { ...first.statuses };
            const failed = first.failed.map((f) => ({ claim: claimOf.get(f.name) ?? f.name, reason: f.reason }));
            if (stage === TAB_L1 && options.isCeo) {
                const onward = first.succeeded.filter((e) => statuses[e] === CEO_PENDING);
                if (onward.length) {
                    const second = await decide(onward, "ceo_approve");
                    Object.assign(statuses, second.statuses);
                    // Its L1 step stands: the claim is in Pending CEO Approval, and why the CEO step failed is said.
                    failed.push(...second.failed.map((f) => ({
                        claim: claimOf.get(f.name) ?? f.name, reason: `Approved by L1, but not by the CEO: ${f.reason}`,
                    })));
                }
            }
            return {
                moved: first.succeeded.map((e) => ({ claim: claimOf.get(e) ?? e, tab: claimTab(statuses[e]) })),
                failed,
            };
        },
        [bulkApprove, decide],
    );

    const reject = useCallback(
        async (stage: ApprovalStage, rows: readonly ClaimRow[], reason: string): Promise<DecisionOutcome> => {
            if (stage === TAB_PENDING) {
                const reply = await bulkReject({ names: JSON.stringify(rows.map((r) => r.name)), reason });
                return fromClaims(reply.message.data);
            }
            const { expenses, claimOf } = expensesOf(rows);
            const result = await decide(expenses, "reject", { reason });
            return {
                moved: result.succeeded.map((e) => ({ claim: claimOf.get(e) ?? e, tab: null })),
                failed: result.failed.map((f) => ({ claim: claimOf.get(f.name) ?? f.name, reason: f.reason })),
            };
        },
        [bulkReject, decide],
    );

    return { approve, reject, busy: approving || rejecting || deciding };
}
