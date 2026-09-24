// src/pages/ProjectPayments/components/expenseBankLinesView.ts
//
// The expense's Bank lines card, on the Payments & Expenses table (#1303, ADR-0027 R5): the one
// progress line it reads and the bar under it. Pure -- no React, no fetch -- so the wording of
// "still to link" is testable without a bank statement.
//
// ⚠️ READ-ONLY, AND CONVENIENCE ONLY. The card changes nothing; the linked total it renders comes
// from `expense_links.load_expense_links`, the ONE aggregate the settle guard and the four document
// rules read. Nothing here decides whether an expense is Paid.
//
// ⚠️ THE ₹5 IS `linkLinesView.LINK_TOLERANCE`, IMPORTED, NEVER A SECOND 5. That constant is the
// frontend's one mirror of `amounts.AMOUNT_TOLERANCE` and is pinned to it by
// `linkLinesParity.test.ts`; a copy here could call an expense short that the server reads Paid.

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { LINK_TOLERANCE } from "@/pages/outflow-import/linkLinesView";
import { ROW_PARTIALLY_ALLOCATED } from "@/pages/outflow-import/outflowImportStatus";

/** One live Settled slip, as `get_expense_bank_lines` returns it. */
export interface ExpenseBankLine {
    /**
     * The `Outflow Row Match` slip -- the LINK, not the line. It is the React key, because a slip is
     * unique per (line, expense) while an import row is not guaranteed to be on a card that later
     * gains a second link to the same statement row.
     */
    match: string;
    /** The `Outflow Import Row` -- the bank line itself. */
    import_row: string;
    /** The statement it arrived on. No longer a column on the card (owner, 2026-09-24). */
    import_batch: string;
    added_on: string | null;
    beneficiary_name: string;
    /** The bank line's own remarks, shown in brackets under the beneficiary. */
    remarks?: string;
    reference: string;
    /**
     * ⚠️ THE SLIP'S `target_amount`, NOT THE BANK ROW'S. Under ADR-0027 that field means "the money
     * that moved between this line and this record", which is what makes the column add up to the
     * linked total on a many-line expense.
     */
    amount: number;
    /** The bank line's own amount -- more than `amount` when the line is split across records. */
    line_amount?: number;
    /** The bank line's status; `Partially Allocated` when part of it is not yet used. */
    line_status?: string;
    /** What the line's live slips, to ANY record, add up to -- and what is left of it. */
    line_reconciled?: number;
    line_pending?: number;
}

/** The whole card's payload. */
export interface ExpenseBankLines {
    doctype: string;
    name: string;
    status: string;
    amount: number;
    linked_total: number;
    line_count: number;
    remaining: number;
    payment_date: string | null;
    lines: ExpenseBankLine[];
    /** The expense's own facts; `null` for a payment. Absent on an older server. */
    details?: ExpenseDetails | null;
}

/** An expense's own facts, as `get_expense_bank_lines` returns them. Blank, never absent. */
export interface ExpenseDetails {
    type: string;
    description: string;
    comment: string;
    project: string;
    project_name: string;
    vendor: string;
    vendor_name: string;
}

export interface LinkedProgress {
    /** The linked figure, read first and bolded: "₹1,38,633". */
    linked: string;
    /** What it is out of, and across how many lines: "of ₹1,60,113 linked · 25 lines". */
    note: string;
    /** "₹21,480 still to link", or `null` once the lines cover the amount. */
    stillToLink: string | null;
    /** The bar's width, 0-100. */
    percent: number;
    /** Whether the lines cover the amount within ₹5 -- the bar reads green rather than orange. */
    complete: boolean;
}

const rupees = (amount: number): string => formatToRoundedIndianRupee(amount);

/** Money compared in paise, so float noise never flips "still to link" at the ₹5 edge. */
const paise = (amount: number): number => Math.round(amount * 100);

const lines = (count: number): string => `${count} ${count === 1 ? "line" : "lines"}`;

/** Just the figures the progress line reads -- the whole payload is more than it needs. */
export type LinkedFigures = Pick<
    ExpenseBankLines,
    "amount" | "linked_total" | "line_count" | "remaining"
>;

/**
 * The card's one progress line and its bar.
 *
 * ⚠️ "WHAT IS LEFT" IS THE SERVER'S `remaining`, NOT `amount - linked_total` RECOMPUTED HERE. The
 * server measures it in Decimal, from the same aggregate the settle guard measures room against; a
 * second definition on this side could print a figure the next link's refusal contradicts.
 *
 * ⚠️ `complete` IS THE SAME ONE-SIDED TEST AS THE SERVER'S `derive_expense_status`: only a SHORTFALL
 * past ₹5 is short. A linked total above the amount is not reachable -- linking is refused past what
 * is left, and the amount cannot be edited below the linked total -- so it reads as covered rather
 * than as a fourth state nobody can produce.
 *
 * ⚠️ THE BAR IS CLAMPED AT BOTH ENDS. An expense whose amount is blank or zero would otherwise
 * divide by zero and render a bar of `NaN%`, which CSS drops silently -- an empty bar that looks
 * like "nothing linked" on a row that is fully linked.
 */
export const linkedProgress = (figures: LinkedFigures): LinkedProgress => {
    const { amount, linked_total: linkedTotal, line_count: lineCount, remaining } = figures;
    const complete = paise(remaining) <= paise(LINK_TOLERANCE);
    const percent = paise(amount) > 0
        ? Math.min(100, Math.max(0, (paise(linkedTotal) / paise(amount)) * 100))
        : complete
          ? 100
          : 0;
    return {
        linked: rupees(linkedTotal),
        note: `of ${rupees(amount)} linked · ${lines(lineCount)}`,
        stillToLink: complete ? null : `${rupees(remaining)} still to link`,
        percent,
        complete,
    };
};

/** The Amount cell's two figures for a part-reconciled row. */
export interface PartReconciled {
    /** What bank lines already cover: "₹5,74,236". */
    reconciled: string;
    /** What is still to link: "₹4,25,764". */
    pending: string;
}

/**
 * The queue's Amount cell under the figure: how much is reconciled and how much is pending, for ANY
 * row -- payment, project or non-project expense -- or `null` when there is nothing part-done to say:
 * no bank line has reached the row, or the lines already cover it.
 *
 * ⚠️ "COVERED" IS `linkedProgress(...).complete`, NOT A SECOND ₹5 TEST, so the cell and the Bank
 * lines card cannot disagree about the same row. `pending` is the server's `remaining`, for the
 * reason `linkedProgress` gives.
 */
export const partReconciled = (figures: LinkedFigures): PartReconciled | null => {
    if (paise(figures.linked_total) <= 0) return null;
    if (linkedProgress(figures).complete) return null;
    return { reconciled: rupees(figures.linked_total), pending: rupees(figures.remaining) };
};

/** A bank line only part used, as the card's note under the lines reads it. */
export interface PartUsedLine {
    beneficiary: string;
    lineAmount: string;
    reconciled: string;
    pending: string;
}

/**
 * The lines on the card that are only PART used -- split across several records with money still
 * to allocate in Bulk Import -- with the line's own figures. Figures are the server's.
 */
export const partUsedLines = (cardLines: readonly ExpenseBankLine[]): PartUsedLine[] =>
    cardLines
        .filter((line) => line.line_status === ROW_PARTIALLY_ALLOCATED)
        .map((line) => ({
            beneficiary: line.beneficiary_name || line.import_row,
            lineAmount: rupees(line.line_amount ?? 0),
            reconciled: rupees(line.line_reconciled ?? 0),
            pending: rupees(line.line_pending ?? 0),
        }));

/**
 * The status chip's colours, as a TOTAL map with a fallback -- the idiom
 * `outflow-import/outflowImportStatus.ts` already sets for row statuses.
 *
 * Paid reads green; Reconciliation Pending reads orange -- the mockups' proposal, since the app has
 * no colour for that status yet. ⚠️ ANYTHING ELSE READS NEUTRAL RATHER THAN GUESSING: a status this
 * card was not designed around (a Rejected expense that still carries links) must not borrow the
 * colour of one it was.
 */
export const STATUS_TONE: Record<string, string> = {
    Paid: "bg-green-100 text-green-800",
    "Reconciliation Pending": "bg-orange-100 text-orange-700",
};

const NEUTRAL_TONE = "bg-muted text-muted-foreground";

export const statusTone = (status: string): string => STATUS_TONE[status] ?? NEUTRAL_TONE;
