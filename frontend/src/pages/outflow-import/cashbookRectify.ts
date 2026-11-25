// src/pages/outflow-import/cashbookRectify.ts
//
// Move a Cashbook spend's expense (#1757, spec #1753): the wallet line's details and the type offered (the wording
// is every source's, `utils/moveLabel.ts`). Pure: no React, no fetch. `cashbookRectify.test.ts` pins it;
// `RectifyDialog` renders it. On screen it is Move; the domain keeps Rectify.
//
// ⚠️ NO RULE OF ITS OWN ABOUT A LINE. Whether a line can move is the server's (`rectify.get_rectify_plan`
// `refusal`); the write re-asks under its locks.

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { RectifyOutcome, RectifyPlanLine, RectifyResult } from "./porterRectify";

export const CASHBOOK_SOURCE = "Cashbook";

const PROJECT_EXPENSE = "Project Expenses";

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
    /** The detail an Internal Transfer starts with (#1762), when the plan offers that destination. */
    transfer_detail?: string;
}

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

// --- The Internal Transfer destination (#1762, spec #1753 stories 13, 27-28) --------------------------------------

/** The Move-to choice that turns each expense into an Internal Transfer (`rectify_transfer.INTERNAL_TRANSFER_DESTINATION`). */
export const INTERNAL_TRANSFER_TARGET = "Internal Transfer";

/** The run button's words for that destination. */
export const MOVE_TO_INTERNAL_TRANSFER = "Move to Internal Transfer";

/** What the plan offers for that destination (`rectify_transfer.transfer_offer`), or `null` where lines cannot go there. */
export interface TransferOffer {
    own_place: string;
    other_ends: string[];
}

/** The Move-to choices: the projects (and No project), then Internal Transfer when the plan offers it. */
export const moveTargets = <T extends { value: string; label: string }>(
    projects: readonly T[],
    transfer: TransferOffer | null | undefined,
): { value: string; label: string }[] =>
    transfer ? [...projects, { value: INTERNAL_TRANSFER_TARGET, label: INTERNAL_TRANSFER_TARGET }] : [...projects];

/**
 * Which end the person chooses, as Mark asks (`hand_mark_ends`): "to" where money went out of the wallet, "from"
 * where it came back in, "either" for a spend moving with its refund (each record runs its own way).
 */
export const transferChosenEnd = (lines: readonly Pick<CashbookPlanLine, "money_in">[]): "to" | "from" | "either" => {
    const ins = lines.filter((line) => line.money_in).length;
    if (ins === 0) return "to";
    return ins === lines.length ? "from" : "either";
};

/** The detail the dialog starts with: the lines' shared one (Mark's: the wallet holder), else blank. */
export const defaultTransferDetail = (lines: readonly Pick<CashbookPlanLine, "transfer_detail">[]): string => {
    const details = [...new Set(lines.map((line) => line.transfer_detail ?? ""))];
    return details.length === 1 ? details[0] : "";
};
