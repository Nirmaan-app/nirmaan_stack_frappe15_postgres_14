// src/pages/outflow-import/cashbookRectify.ts
//
// Move a Cashbook spend's expense (#1757, spec #1753): the button and title wording, the wallet line's details and
// the type offered. Pure: no React, no fetch. `cashbookRectify.test.ts` pins it; `RectifyDialog`, `OutflowRowsTable`,
// `OutflowMasterPage` and the expense edit dialogs render it. On screen it is Move; the domain keeps Rectify.
//
// ⚠️ NO RULE OF ITS OWN ABOUT A LINE. Whether a line can move is the server's (`rectify.get_rectify_plan`
// `refusal`); the write re-asks under its locks.

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { RectifyOutcome, RectifyPlanLine, RectifyResult } from "./porterRectify";

export const CASHBOOK_SOURCE = "Cashbook";

const PROJECT_EXPENSE = "Project Expenses";

export const MOVE_TO_A_PROJECT = "Move to a project";
export const CHANGE_PROJECT = "Change project";

/** The latest bill on the expense, with its Bill check. */
export interface MoveBill {
    file: string;
    check: string;
    check_reason: string;
}

/** A Cashbook line of the plan: the shared fields plus what the wallet statement says. */
export interface CashbookPlanLine extends Omit<RectifyPlanLine, "crn"> {
    txn_id?: string | null;
    date?: string | null;
    kind?: string;
    /** A wallet refund or credit: money back into the wallet, booked at minus itself. */
    money_in?: boolean;
    spender?: string;
    counterparty?: string;
    remark?: string;
    expense_type?: string;
    bill?: MoveBill | null;
}

/**
 * The button and the dialog title (stories 37-39): "Move to a project" when every expense is a Non Project Expense,
 * "Change project" when every one is on a project, "Move N expenses" for a mixed selection.
 */
export const cashbookMoveLabel = (ledgers: readonly (string | null | undefined)[]): string => {
    const onProject = ledgers.filter((ledger) => ledger === PROJECT_EXPENSE).length;
    if (onProject === 0) return MOVE_TO_A_PROJECT;
    if (onProject === ledgers.length) return CHANGE_PROJECT;
    return `Move ${ledgers.length} expenses`;
};

const orDash = (value: string | null | undefined) => (value || "").trim() || "--";

/** The wallet line's details (story 42), one compact row per line in the dialog (story 45). The bill is a link, the caller's. */
export const cashbookDetailRows = (line: CashbookPlanLine): { label: string; value: string }[] => [
    { label: "Date", value: line.date ? formatDate(line.date) : "--" },
    { label: line.money_in ? "Back to" : "Spent by", value: orDash(line.spender) },
    { label: line.money_in ? "From" : "Paid to", value: orDash(line.counterparty) },
    { label: "Amount", value: formatToRoundedIndianRupee(line.amount) },
    { label: "Remark", value: orDash(line.remark) },
];

/** The Bill check verdict with its remark, or "No bill". */
export const billCheckText = (bill: MoveBill | null | undefined): string => {
    if (!bill) return "No bill";
    const reason = (bill.check_reason || "").trim();
    return reason ? `${bill.check}: ${reason}` : bill.check;
};

/** The write's answer about the phrase it was given (#1758): saved, already this project's, or refused with why. */
export interface LearnedPhrase {
    phrase: string;
    saved: boolean;
    reason?: string;
}

/** A Cashbook Move's result: the shared one, and the phrase's answer when a phrase was sent to a project. */
export interface CashbookMoveResult extends RectifyResult {
    phrase?: LearnedPhrase;
}

/**
 * What a run reports: how many expenses moved where, what the phrase taught, and each line that did not move, in the
 * server's own words.
 */
export const cashbookOutcome = (result: CashbookMoveResult, targetName: string | null): RectifyOutcome => {
    const moved = result.lines.filter((line) => line.rectified).length;
    return {
        moved,
        title: moved
            ? `${moved} ${moved === 1 ? "expense" : "expenses"} moved to ${targetName || "Non Project"}.`
            : "Nothing was moved.",
        notes: phraseNote(result.phrase, targetName),
        failed: result.lines
            .filter((line) => !line.rectified)
            .map((line) => ({ row: line.row, reason: line.reason ?? "Not moved." })),
    };
};

/** The ledger an expense moving to `target` lands on ("" is No project). */
export const destinationLedger = (target: string): string => (target ? PROJECT_EXPENSE : "Non Project Expenses");

/**
 * The type the dialog starts with (story 15): the lines' own type when they share one and the destination ledger
 * takes it, else blank, so a person chooses.
 */
export const defaultMoveType = (
    lines: readonly CashbookPlanLine[],
    ledger: string,
    types: Readonly<Record<string, readonly string[]>>,
): string => {
    const own = [...new Set(lines.map((line) => line.expense_type ?? ""))];
    return own.length === 1 && own[0] && (types[ledger] ?? []).includes(own[0]) ? own[0] : "";
};

/** A word as the import's alias matcher reads one (`project_match.alias_haystack`): letters and digits, any case. */
const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The phrase the box starts with (#1758, story 48): from the first moving line whose remark names the destination,
 * the longest run of consecutive remark words that are words of the project's name (the first run on a tie), as the
 * remark writes it. Blank when no remark word is in the name (a nickname, a typo), so the person types the phrase.
 */
export const suggestedPhrase = (lines: readonly CashbookPlanLine[], projectName: string): string => {
    const nameWords = new Set(Array.from(projectName.toLowerCase().matchAll(WORD), (match) => match[0]));
    for (const line of lines) {
        const remark = line.remark ?? "";
        let best = "";
        let runStart = -1;
        let runEnd = -1;
        let runLength = 0;
        let bestLength = 0;
        for (const match of remark.matchAll(WORD)) {
            const start = match.index ?? 0;
            if (!nameWords.has(match[0].toLowerCase())) {
                runLength = 0;
                continue;
            }
            if (runLength === 0) runStart = start;
            runEnd = start + match[0].length;
            runLength += 1;
            if (runLength > bestLength) {
                bestLength = runLength;
                best = remark.slice(runStart, runEnd);
            }
        }
        if (best) return best;
    }
    return "";
};

/** The box's sentence (story 47), with the phrase in it once there is one. */
export const learnPhraseLabel = (phrase: string): string =>
    `Next time, put spends that mention ${phrase.trim() ? `“${phrase.trim()}”` : "[phrase]"} on this project`;

/** What the outcome says of the phrase the write was given (`rectify_phrase.learn_phrase`'s answer), if any. */
const phraseNote = (learned: LearnedPhrase | undefined, targetName: string | null): string[] => {
    if (!learned) return [];
    if (learned.reason) return [`The phrase was not saved: ${learned.reason}`];
    return learned.saved
        ? [`Next time, spends that mention “${learned.phrase}” go to ${targetName}.`]
        : [`“${learned.phrase}” already puts spends on ${targetName}.`];
};
