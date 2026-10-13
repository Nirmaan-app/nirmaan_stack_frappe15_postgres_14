// src/pages/outflow-import/waitingRefundMatch.ts
//
// "Match a waiting Vendor Refund" in the decision dialog (#1401, ADR-0032). A refund procurement
// recorded from "Adjust Payments" before the bank line waits at Reconciliation Pending; a credit line is
// matched to one or more of them instead of creating a second refund. Pure: no React, no fetch.
//
// ⚠️ CONVENIENCE ONLY. The server (`inflows.match_waiting_refunds`, rule
// `services/vendor_refunds.waiting_match_problem`) re-reads every refund under lock and re-checks that
// each is still waiting, all one vendor's, and that together they add up EXACTLY to the line (owner,
// 2026-10-13: no partial allocation for credit lines).

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

/** One row of `inflows.get_waiting_vendor_refunds`: a refund this vendor's credit line may be matched to. */
export interface WaitingRefund {
    name: string;
    amount: number;
    document_type: string | null;
    document_name: string | null;
    project: string | null;
    project_name: string | null;
    payment_date: string | null;
    utr: string | null;
    waiting_created_by: string | null;
    creation: string;
}

/** One ticked refund: its amount from the pool at tick time, and how it reads (its PO). */
export interface WaitingRefundPick {
    name: string;
    amount: number;
    label: string;
}

export interface WaitingRefundForm {
    /** Absent means "never touched", null "deliberately cleared" -- the `linkTo` contract. */
    vendor?: string | null;
    picks?: WaitingRefundPick[];
}

/** The SWR key of a vendor's waiting refunds, shared by both refund cards so they read one fetch. The
 *  page revalidates every key with this prefix after a write, since a match or an undo moves the pool. */
export const WAITING_REFUNDS_KEY_PREFIX = "outflow-waiting-vendor-refunds-";

export const waitingRefundsKey = (vendor: string | null | undefined): string | null =>
    vendor ? `${WAITING_REFUNDS_KEY_PREFIX}${vendor}` : null;

/** Money in whole paise, so the exact-sum comparison is exact. The server compares at the paisa too. */
const toPaise = (value: number | null | undefined): number => Math.round((Number(value) || 0) * 100);

/** The box shown once a vendor is chosen, on both refund cards. */
export const waitingRefundsHeadline = (count: number): string =>
    `This vendor has ${count} waiting ${count === 1 ? "refund" : "refunds"}`;

/** The form after a change of vendor: a new vendor clears every tick, since none of them is theirs. */
export const withWaitingRefundVendor = (
    form: WaitingRefundForm,
    vendor: string | null | undefined
): WaitingRefundForm => (vendor === form.vendor ? form : { vendor, picks: [] });

/** Tick or untick one waiting refund. */
export const toggleWaitingRefund = (form: WaitingRefundForm, refund: WaitingRefund): WaitingRefundForm => {
    const picks = form.picks ?? [];
    if (picks.some((p) => p.name === refund.name)) {
        return { ...form, picks: picks.filter((p) => p.name !== refund.name) };
    }
    return {
        ...form,
        picks: [...picks, { name: refund.name, amount: refund.amount, label: refund.document_name || refund.name }],
    };
};

/** What the ticked refunds take of the line, and what is left of it -- the running balance. */
export const waitingRefundTotals = (
    form: WaitingRefundForm | undefined,
    lineAmount: number
): { matched: number; remaining: number } => {
    const matchedPaise = (form?.picks ?? []).reduce((sum, p) => sum + toPaise(p.amount), 0);
    return { matched: matchedPaise / 100, remaining: (toPaise(lineAmount) - matchedPaise) / 100 };
};

/** Why this match cannot be confirmed yet, or `null` when it can. */
export const waitingRefundProblem = (
    form: WaitingRefundForm | undefined,
    lineAmount: number
): string | null => {
    if (!form?.vendor?.trim()) return "Choose the vendor.";
    if (!(form.picks ?? []).length) return "Tick at least one waiting refund.";
    const { remaining } = waitingRefundTotals(form, lineAmount);
    if (toPaise(remaining) > 0) {
        return `${formatToRoundedIndianRupee(remaining)} of the line is not matched yet. The refunds must add up to the line exactly.`;
    }
    if (toPaise(remaining) < 0) {
        return `The refunds are ${formatToRoundedIndianRupee(-remaining)} more than the line. They must add up to the line exactly.`;
    }
    return null;
};

/** The `refunds` the match posts: the ticked refunds' names, in tick order. */
export const waitingRefundNames = (form: WaitingRefundForm | undefined): string[] =>
    (form?.picks ?? []).map((p) => p.name);
