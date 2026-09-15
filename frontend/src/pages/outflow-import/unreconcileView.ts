// src/pages/outflow-import/unreconcileView.ts
//
// The Unreconcile dialog's sentences, its Reverse all footer, the notice an undo ends in, and what a
// Settled line's Outcome cell offers (#1275, parent #1270, ADR-0022). Pure: no React, no fetch.
// `UnreconcileDialog` / `OutflowRowsTable` render these; `unreconcileView.test.ts` pins them.
//
// ⚠️ CONVENIENCE ONLY. The server decides every verdict (`services/outflow_import/unreconcile.py`) and
// recomputes it under its locks on the write; nothing here decides whether money moves.

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { NEVER_MATCHED_SOURCES, ROW_PARTIALLY_ALLOCATED, ROW_SETTLED } from "./outflowImportStatus";

/** Mirrors `unreconcile.VERDICT_*`; the test reads the Python. */
export const VERDICT_REVERT_PAYMENT = "revert_payment";
export const VERDICT_REVERT_EXPENSE = "revert_expense";
/** A record the import created is deleted (red in the dialog, #1278). */
export const VERDICT_DELETE_CREATED = "delete_created";
export const VERDICT_REFUSED = "refused";

/** The verdicts that put a record back to Approved (blue in the dialog). */
const BACK_TO_APPROVED = new Set([VERDICT_REVERT_PAYMENT, VERDICT_REVERT_EXPENSE]);

/** Mirrors `unreconcile.CASHBOOK_REFUSAL`, shown in the table instead of a button (story 27). */
export const UNRECONCILE_CASHBOOK_SENTENCE = "Cashbook rows can't be unreconciled yet.";

/** The ticket's footer sentence for one refused record. */
export const REVERSE_ALL_BLOCKED_ONE =
    "Reverse all is off because one record can't be undone. Nothing changes unless every record can be undone.";

/** One Settled leg as `unreconcile.get_unreconcile_plan` returns it. */
export interface UnreconcilePlanLeg {
    match: string;
    target_doctype: string;
    target_name: string;
    target_amount: number;
    matched_at?: string | null;
    verdict: string;
    /** `null` on a refusal. */
    what_happens: string | null;
    /** `null` unless refused. */
    reason: string | null;
    title: string | null;
    fix_at: string | null;
}

export interface UnreconcilePlan {
    row: string;
    row_status: string;
    amount: number;
    beneficiary_name?: string | null;
    reference?: string | null;
    added_on?: string | null;
    allocated: number;
    refused_count: number;
    legs: UnreconcilePlanLeg[];
}

export interface ReversedLeg {
    match: string;
    target_doctype: string;
    target_name: string;
    verdict: string;
    /** The leg's own figure. */
    reversed_amount: number;
    /** The record's amount read back after the save; `null` when it no longer exists. */
    amount_after: number | null;
}

/** What `unreconcile.unreconcile_row` returns. */
export interface UnreconcileResult {
    row: string;
    row_status: string;
    allocated: number;
    remaining: number;
    batch_status?: string;
    reversed: ReversedLeg[];
}

/** Blue = back to Approved, red = deleted, grey = refused (mockup scene 3). `other` is a verdict this
 *  screen has no colour for yet; it still shows the server's sentence. */
export type LegTone = "back" | "deleted" | "refused" | "other";

export interface LegOutcomeLine {
    tone: LegTone;
    /** Bold lead-in before the sentence, or `null`. */
    lead: string | null;
    text: string;
}

/**
 * The coloured "what happens" line beside one record.
 *
 * ⚠️ THE SENTENCE IS THE SERVER'S; a screen-side rewording would drift from the refusal the write
 * throws. Only the lead-in is added, plus "Fix it on <fix_at>." when the server names a place to fix
 * it that the sentence itself does not already mention (mockup scene 3: "with the reason and where to
 * fix it").
 */
export const legOutcomeLine = (leg: UnreconcilePlanLeg): LegOutcomeLine => {
    if (leg.verdict === VERDICT_REFUSED) {
        const reason = (leg.reason ?? "").trim();
        const where = (leg.fix_at ?? "").trim();
        const text =
            where && !reason.toLowerCase().includes(where.toLowerCase())
                ? `${reason} Fix it on ${where}.`.trim()
                : reason;
        return { tone: "refused", lead: "Can't be undone here.", text };
    }
    return {
        tone: BACK_TO_APPROVED.has(leg.verdict)
            ? "back"
            : leg.verdict === VERDICT_DELETE_CREATED
              ? "deleted"
              : "other",
        lead: null,
        text: leg.what_happens ?? "",
    };
};

const records = (count: number) => `${count} ${count === 1 ? "record" : "records"}`;

export const recordsHeading = (plan: UnreconcilePlan): string =>
    `${records(plan.legs.length)} on this transfer`;

export const reverseAllLabel = (plan: UnreconcilePlan): string => `Reverse all ${plan.legs.length}`;

/**
 * Why Reverse all is off, as the footer says it -- or `null` when it is not.
 *
 * ⚠️ ALL OR NOTHING IS THE SERVER'S RULE (`first_refusal`): one refused record and the write changes
 * nothing, so offering the button would only produce a refusal. The sentence says so in words, not a
 * tooltip (mockup scene 2).
 */
export const reverseAllBlockedSentence = (plan: UnreconcilePlan): string | null => {
    const refused = plan.legs.filter((leg) => leg.verdict === VERDICT_REFUSED).length;
    if (refused === 0) return null;
    if (refused === 1) return REVERSE_ALL_BLOCKED_ONE;
    return `Reverse all is off because ${refused} records can't be undone. Nothing changes unless every record can be undone.`;
};

export interface UnreconcileNotice {
    title: string;
    body: string;
}

/**
 * The notice after an Unreconcile: what came off, where the line now stands, and any amount the save
 * changed (#1270 stories 38, 39).
 *
 * ⚠️ BUILT FROM THE RESPONSE, NEVER FROM WHAT WAS CLICKED. `amount_after` is read back by the server
 * after the commit; a Service Request payment put back to Approved may have been netted for TDS
 * (owner ruling: left as it is), and this is the only place the screen says so.
 *
 * ⚠️ A STILL-PARTLY-ALLOCATED LINE STATES THE BALANCE, NEVER A LEG COUNT -- ADR-0020's rule, the same
 * one `allocation_note` states server-side.
 */
export const unreconcileNotice = (result: UnreconcileResult): UnreconcileNotice => {
    const total = result.reversed.length;
    const reverted = result.reversed.filter((leg) => BACK_TO_APPROVED.has(leg.verdict)).length;
    const deleted = result.reversed.filter((leg) => leg.verdict === VERDICT_DELETE_CREATED).length;
    const wasDeleted = (count: number) => (count === 1 ? "was deleted" : "were deleted");
    const head =
        reverted === total
            ? `${records(total)} came off this transfer and went back to Approved.`
            : deleted === total
              ? `${records(total)} came off this transfer and ${wasDeleted(total)}.`
              : reverted + deleted === total
                ? `${records(total)} came off this transfer: ${reverted} went back to Approved and ${deleted} ${wasDeleted(deleted)}.`
                : `${records(total)} came off this transfer.`;
    const where =
        result.row_status === ROW_PARTIALLY_ALLOCATED
            ? `${formatToRoundedIndianRupee(result.remaining)} of it is unallocated again.`
            : result.row_status === ROW_SETTLED
              ? "It is still fully allocated."
              : "It now needs a record.";
    const changed = result.reversed
        .filter((leg) => leg.amount_after !== null && leg.amount_after !== leg.reversed_amount)
        .map(
            (leg) =>
                `${leg.target_name} is now ${formatToRoundedIndianRupee(leg.amount_after!)}, not ${formatToRoundedIndianRupee(leg.reversed_amount)}.`,
        );
    return { title: "Unreconciled.", body: [head, where, ...changed].join(" ") };
};

/**
 * What a line's Outcome cell offers for an undo: the Unreconcile button, the Cashbook sentence, or
 * nothing.
 *
 * ⚠️ ONLY A SETTLED LINE. A Partially Allocated line keeps its Outcome button and undoes inside the
 * decision dialog's "Already allocated" section, which reuses the same record list.
 *
 * ⚠️ `canUndo` IS `outflowImportStatus.canUndoOutflow` -- a plain Accountant sees neither the button
 * nor the Cashbook sentence, which would otherwise describe a control they never have.
 */
export const unreconcileAffordance = (
    row: { row_status: string; source?: string | null },
    canUndo: boolean,
): "button" | "cashbook" | null => {
    if (!canUndo || row.row_status !== ROW_SETTLED) return null;
    return NEVER_MATCHED_SOURCES.has((row.source ?? "").trim()) ? "cashbook" : "button";
};
