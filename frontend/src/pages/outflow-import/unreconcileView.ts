// src/pages/outflow-import/unreconcileView.ts
//
// The Unreconcile dialog's sentences, its Reverse all footer, the notice an undo ends in, and what a
// Settled line's Outcome cell offers (#1275, parent #1270, ADR-0022). Pure: no React, no fetch.
// `UnreconcileDialog` / `OutflowRowsTable` render these; `unreconcileView.test.ts` pins them.
//
// ⚠️ CONVENIENCE ONLY. The server decides every verdict (`services/outflow_import/unreconcile.py`) and
// recomputes it under its locks on the write; nothing here decides whether money moves.

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    NEVER_MATCHED_SOURCES,
    OPEN_ROW_STATUSES,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
} from "./outflowImportStatus";

/** Mirrors `unreconcile.VERDICT_*`; the test reads the Python. */
export const VERDICT_REVERT_PAYMENT = "revert_payment";
export const VERDICT_REVERT_EXPENSE = "revert_expense";
/** A record the import created is deleted (red in the dialog, #1278). */
export const VERDICT_DELETE_CREATED = "delete_created";
/** A part payment's split is joined back, then the payment reverts (amber in the dialog, #1279). */
export const VERDICT_UNSPLIT_PAYMENT = "unsplit_payment";
/** One line comes off an expense several lines settle; the expense keeps its amount and reference (blue, #1300). */
export const VERDICT_UNLINK_EXPENSE_LINE = "unlink_expense_line";
export const VERDICT_REFUSED = "refused";

/** Mirrors `unreconcile.WHAT_HAPPENS_UNSPLIT`: the amber line's lead-in. */
export const WHAT_HAPPENS_UNSPLIT = "The split is undone:";

/** Mirrors `unsplit.LEFTOVER_PAID_TITLE`: the one refusal that clears once another transfer is undone,
 *  so it leads "Can't be undone yet." (mockup scene 3) where every other refusal says "here". */
export const LEFTOVER_PAID_TITLE = "Leftover paid";

/** The verdicts that put a record back to the settleable status (blue in the dialog). */
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
    /** `unsplit_payment` only (#1279): the leftover deleted, and what the payment goes back to. */
    leftover?: string | null;
    leftover_amount?: number | null;
    restored_amount?: number | null;
    /** Whether the PO's two payment terms join back into one (a Service Request payment has none). */
    joins_terms?: boolean;
    /** `unlink_expense_line` only (#1300): what the other live lines add up to, how many there are, the
     *  expense's own amount, and whether those lines still make it Paid. */
    stays_linked?: number | null;
    other_lines?: number | null;
    expense_amount?: number | null;
    stays_paid?: boolean | null;
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
    /**
     * The line may only be undone WHOLE -- it carries a vendor refund. The server refuses a request
     * naming only some of its records, so the screen offers Reverse all only.
     */
    reverse_all_only?: boolean;
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
    /** `unsplit_payment` only (#1279). */
    leftover?: string | null;
    restored_amount?: number | null;
    /** `unlink_expense_line` only (#1300). */
    stays_paid?: boolean | null;
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

/** Blue = back to the settleable status, red = deleted, amber = a split joined back, grey = refused (mockup scene
 *  3). `other` is a verdict this screen has no colour for yet; it still shows the server's sentence. */
export type LegTone = "back" | "deleted" | "split" | "refused" | "other";

export interface LegOutcomeLine {
    tone: LegTone;
    /** Bold lead-in before the sentence, or `null`. */
    lead: string | null;
    text: string;
    /** A bullet list under the sentence -- only the amber un-split line has one. */
    items?: string[];
}

/**
 * The three consequences under "The split is undone:" (mockup scene 3), from the figures the server
 * put on the leg. The PO terms bullet only when there are terms to join.
 */
export const unsplitConsequences = (leg: UnreconcilePlanLeg): string[] => [
    `${leg.target_name} goes back to ${formatToRoundedIndianRupee(leg.restored_amount ?? 0)}, Reconciliation Pending`,
    `the leftover ${leg.leftover ?? ""} (${formatToRoundedIndianRupee(leg.leftover_amount ?? 0)}) is deleted`,
    ...(leg.joins_terms ? ["the PO's two payment terms join back into one"] : []),
];

/**
 * The three consequences under "Only this line comes off." (#1300, mockup board 6), from the figures the
 * server put on the leg. ⚠️ THE DATE LINE FOLLOWS `stays_paid`: the write re-derives the expense from the
 * lines left, so it keeps a date only when those still fill it.
 */
export const expenseLineConsequences = (leg: UnreconcilePlanLeg): string[] => {
    const others = leg.other_lines ?? 0;
    return [
        others > 0
            ? `${formatToRoundedIndianRupee(leg.stays_linked ?? 0)} stays linked, across ${others} other ${
                  others === 1 ? "line" : "lines"
              }`
            : "No other line stays linked",
        leg.stays_paid
            ? "The payment date becomes the latest remaining line's. The reference is kept."
            : "The payment date is cleared. The reference is kept.",
        "The amount is not changed",
    ];
};

/** The figure beside a record: the leg's own amount, and "of" the expense's on a many-line expense (#1300). */
export const legAmountLabel = (leg: UnreconcilePlanLeg): string =>
    leg.verdict === VERDICT_UNLINK_EXPENSE_LINE && leg.expense_amount != null
        ? `${formatToRoundedIndianRupee(leg.target_amount)} of ${formatToRoundedIndianRupee(leg.expense_amount)}`
        : formatToRoundedIndianRupee(leg.target_amount);

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
        const lead = leg.title === LEFTOVER_PAID_TITLE ? "Can't be undone yet." : "Can't be undone here.";
        return { tone: "refused", lead, text };
    }
    if (leg.verdict === VERDICT_UNSPLIT_PAYMENT) {
        return { tone: "split", lead: null, text: leg.what_happens ?? "", items: unsplitConsequences(leg) };
    }
    if (leg.verdict === VERDICT_UNLINK_EXPENSE_LINE) {
        return {
            tone: "back",
            lead: null,
            text: leg.what_happens ?? "",
            items: expenseLineConsequences(leg),
        };
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

/** Two rupee figures that round to the same paisa. A restored amount is a sum of two stored figures and
 *  may carry float noise the server's own comparison never sees. */
const sameMoney = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

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
 * after the commit, so the screen states what was actually written rather than what was asked for.
 *
 * ⚠️ AN UNRECONCILE NO LONGER CHANGES A WORK ORDER PAYMENT'S AMOUNT (#1288, retiring ADR-0022's
 * "TDS on Approved" ruling). It used to: putting a Service Request payment back to Approved read as
 * an approval and withheld TDS, netting the amount, and this sentence was the only place the screen
 * said so. Tax is now withheld only on an approval from an earlier step, so the ordinary undo leaves
 * `amount_after` equal to the amount before and the sentence does not appear. IT IS KEPT AS A
 * BACKSTOP, not deleted -- it reports whatever the server actually wrote, whatever wrote it, and a
 * silent amount change is exactly the thing a reviewer must not have to discover for themselves.
 *
 * ⚠️ A STILL-PARTLY-ALLOCATED LINE STATES THE BALANCE, NEVER A LEG COUNT -- ADR-0020's rule, the same
 * one `allocation_note` states server-side.
 */
export const unreconcileNotice = (result: UnreconcileResult): UnreconcileNotice => {
    const total = result.reversed.length;
    // An un-split payment goes back to the settleable status too (#1279); its split gets its own sentence below.
    // A line off a many-line expense does too, unless the lines left still fill it (#1300).
    const reverted = result.reversed.filter(
        (leg) =>
            BACK_TO_APPROVED.has(leg.verdict) ||
            leg.verdict === VERDICT_UNSPLIT_PAYMENT ||
            (leg.verdict === VERDICT_UNLINK_EXPENSE_LINE && !leg.stays_paid),
    ).length;
    const deleted = result.reversed.filter((leg) => leg.verdict === VERDICT_DELETE_CREATED).length;
    const wasDeleted = (count: number) => (count === 1 ? "was deleted" : "were deleted");
    const head =
        reverted === total
            ? `${records(total)} came off this transfer and went back to Reconciliation Pending.`
            : deleted === total
              ? `${records(total)} came off this transfer and ${wasDeleted(total)}.`
              : reverted + deleted === total
                ? `${records(total)} came off this transfer: ${reverted} went back to Reconciliation Pending and ${deleted} ${wasDeleted(deleted)}.`
                : `${records(total)} came off this transfer.`;
    const where =
        result.row_status === ROW_PARTIALLY_ALLOCATED
            ? `${formatToRoundedIndianRupee(result.remaining)} of it is unallocated again.`
            : result.row_status === ROW_SETTLED
              ? "It is still fully allocated."
              : "It now needs a record.";
    const unsplit = result.reversed
        .filter((leg) => leg.verdict === VERDICT_UNSPLIT_PAYMENT)
        .map((leg) => `The split on ${leg.target_name} was undone and its leftover ${leg.leftover ?? ""} deleted.`);
    // ⚠️ AN UN-SPLIT PAYMENT IS COMPARED AGAINST THE AMOUNT IT WAS RESTORED TO, not the leg's figure:
    // growing back to the whole sanction is the point, and only a change on top of that is news.
    const expected = (leg: ReversedLeg) =>
        leg.verdict === VERDICT_UNSPLIT_PAYMENT ? (leg.restored_amount ?? leg.reversed_amount) : leg.reversed_amount;
    // ⚠️ A LINE OFF A MANY-LINE EXPENSE IS NEVER A CHANGED AMOUNT (#1300): the leg carries ONE line's
    // figure while the expense keeps its own, which the write never touches. Comparing the two would
    // report every such undo as an amount somebody changed.
    const changed = result.reversed
        .filter((leg) => leg.verdict !== VERDICT_UNLINK_EXPENSE_LINE)
        .filter((leg) => leg.amount_after !== null && !sameMoney(leg.amount_after, expected(leg)))
        .map(
            (leg) =>
                `${leg.target_name} is now ${formatToRoundedIndianRupee(leg.amount_after!)}, not ${formatToRoundedIndianRupee(expected(leg))}.`,
        );
    return { title: "Unreconciled.", body: [head, where, ...unsplit, ...changed].join(" ") };
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

// --- Confirm by hand (#1280) ----------------------------------------------------------------------

/** The amber chip on an unreconciled open line (mockup scene 1, last row). */
export const CONFIRM_BY_HAND_CHIP = "Confirm by hand";

/** Mirrors `expenses.CONFIRM_BY_HAND_REFUSAL` -- what `settle_row(bulk=1)` refuses a marked line with. */
export const CONFIRM_BY_HAND_REFUSAL =
    "This transfer was unreconciled, so it is left out of Confirm all matched. Open it and confirm it by hand.";

export interface ConfirmByHandNote {
    /** "Unreconciled on 15-Sep-2026." -- or "Unreconciled." when the date could not be read. */
    lead: string;
    /** "Same pick as before:" / "Now matched:" before the record, or `null` when there is no pick. */
    pickLabel: string | null;
    pick: string | null;
    /** The whole sentence, for the cell's `title`. */
    text: string;
}

/**
 * "Unreconciled on <date>. Same pick as before: <record>" for a marked OPEN line, or `null` (#1280).
 *
 * ⚠️ "SAME PICK AS BEFORE" ONLY WHEN IT IS. A match re-run keeps the marker but may change the pick, so
 * the pick is compared with the records that came off in the last unreconcile; a different one reads
 * "Now matched:" rather than a claim that is false.
 *
 * ⚠️ OPEN LINES ONLY. Reversing one leg of a split leaves the line Partially Allocated and marked; its
 * Outcome cell keeps the allocation note, and the next allocation by hand clears the marker.
 */
export const confirmByHandNote = (row: {
    row_status: string;
    confirm_by_hand?: boolean | null;
    unreconciled_at?: string | null;
    unreconciled_targets?: string[] | null;
    suggested_name?: string | null;
}): ConfirmByHandNote | null => {
    if (!row.confirm_by_hand || !OPEN_ROW_STATUSES.has(row.row_status)) return null;
    const day = (row.unreconciled_at ?? "").split(/[ T]/)[0];
    const lead = day ? `Unreconciled on ${formatDate(day)}.` : "Unreconciled.";
    const pick = (row.suggested_name ?? "").trim() || null;
    const pickLabel = !pick
        ? null
        : (row.unreconciled_targets ?? []).includes(pick)
          ? "Same pick as before:"
          : "Now matched:";
    return { lead, pickLabel, pick, text: pick ? `${lead} ${pickLabel} ${pick}` : lead };
};

/**
 * The confirm dialog's `needs_you` list, cut into the lines with several candidates and the lines
 * marked Confirm by hand (#1280). The server files both under `needs_you` -- neither is confirmable
 * in bulk -- but "matched more than one record" is false for an unreconciled line.
 */
export const splitNeedsYou = <T extends { confirm_by_hand?: boolean | null }>(
    rows: readonly T[],
): { several: T[]; byHand: T[] } => ({
    several: rows.filter((row) => !row.confirm_by_hand),
    byHand: rows.filter((row) => row.confirm_by_hand),
});
