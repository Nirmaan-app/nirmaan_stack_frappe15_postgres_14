// src/pages/outflow-import/cardRectify.ts
//
// Move a card spend's expense to a Won project (#1761, spec #1753 stories 4, 43; ADR-0039 Amendment F): the card
// line's details in the Move dialog. Pure: no React, no fetch. `cardRectify.test.ts` pins it; `RectifyDialog`
// renders it. The button and title wording is Cashbook's (`cashbookRectify.cashbookMoveLabel`), the same for every
// source that moves an expense between ledgers.
//
// ⚠️ NO RULE OF ITS OWN ABOUT A LINE. Whether a line can move is the server's (`rectify.get_rectify_plan`
// `refusal`: a card refund stays Non Project); the write re-asks under its locks.

import { statementMonthsLabel } from "@/pages/tasks/invoices/utils/cardInvoicesView";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { RectifyPlanLine } from "./porterRectify";

/** A card line of the plan: the shared fields plus what the card statement says. */
export interface CardPlanLine extends Omit<RectifyPlanLine, "crn"> {
    /** The statement line's SerNo. */
    txn_id?: string | null;
    date?: string | null;
    holder?: string;
    /** The cleaned merchant name (`card_statement.merchant_key`). */
    merchant?: string;
    /** The statement line's transaction details. */
    details?: string;
    /** The Credit Card Statement's name. */
    statement?: string;
    /** Every "YYYY-MM" the statement's period overlaps. */
    statement_months?: string[];
    expense_type?: string;
}

const orDash = (value: string | null | undefined) => (value || "").trim() || "--";

/** The card spend's details (story 43), one compact row per line in the dialog (story 45). */
export const cardDetailRows = (line: CardPlanLine): { label: string; value: string }[] => {
    const months = statementMonthsLabel(line.statement_months ?? []);
    return [
        { label: "Date", value: line.date ? formatDate(line.date) : "--" },
        { label: "Card holder", value: orDash(line.holder) },
        { label: "Merchant", value: orDash(line.merchant) },
        { label: "Statement", value: [months, line.statement].filter(Boolean).join(" · ") || "--" },
        { label: "Amount", value: formatToRoundedIndianRupee(line.amount) },
    ];
};
