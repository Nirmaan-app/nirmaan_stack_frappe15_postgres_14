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
 * Move's words on any wired source (#1757; Porter #1759): the button, the dialog title and an expense's hint
 * (stories 37-39). "Move to a project" when every expense is a Non Project Expense,
 * "Change project" when every one is on a project, "Move N expenses" for a mixed selection.
 */
export const moveLabel = (ledgers: readonly (string | null | undefined)[]): string => {
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

/** What a run reports: how many expenses moved where, and each line that did not, in the server's own words. */
export const cashbookOutcome = (result: RectifyResult, targetName: string | null): RectifyOutcome => {
    const moved = result.lines.filter((line) => line.rectified).length;
    return {
        moved,
        title: moved
            ? `${moved} ${moved === 1 ? "expense" : "expenses"} moved to ${targetName || "Non Project"}.`
            : "Nothing was moved.",
        notes: [],
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
