// src/pages/outflow-import/cardCreate.ts
//
// Review the card spends' types, then Create (#1568, spec #1565, ADR-0037): pure view logic. No React, no
// fetch. `CardImportReview` and `ImportStatementDialog` render it; `cardCreate.test.ts` pins it. The server
// (`card_review.py`, `card_create.py`) asks every rule again.

import type { CardImport, CardImportLine } from "./creditCardImport";

export const CARD_CREATE_METHOD = "nirmaan_stack.api.outflow_import.card_create.create_card_expenses";
export const CARD_SET_TYPE_METHOD = "nirmaan_stack.api.outflow_import.card_review.set_card_expense_type";

/** How often the dialog re-reads the import while the Create job is queued or running. */
export const CARD_CREATE_POLL_MS = 2000;

export type CardCreateProgress = Pick<
    CardImport,
    "spends" | "created" | "failed" | "to_create" | "create_running" | "suggest_running" | "discardable"
>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Create has started: its job is queued or running, or it has written (Discard is gone from then on). */
export const cardCreateStarted = (card: CardCreateProgress | null | undefined): boolean =>
    Boolean(card && (card.create_running || !card.discardable));

/** The dialog polls while the type suggestion (#1569) or the Create job is queued or running. */
export const cardPolling = (
    card: Pick<CardImport, "create_running" | "suggest_running"> | null | undefined,
): boolean => Boolean(card?.create_running || card?.suggest_running);

/** What Review says while the types are still being suggested; null once they are. */
export const cardSuggestNote = (card: Pick<CardImport, "suggest_running">): string | null =>
    card.suggest_running ? "Suggesting expense types… Review updates when it is done." : null;

/**
 * Create is offered while spends are left to create (waiting, failed on a run, or reopened by Unreconcile),
 * its job is not running, and the types are no longer being suggested.
 */
export const canCreateCard = (card: CardCreateProgress): boolean =>
    !card.create_running && !card.suggest_running && card.to_create > 0;

export const cardCreateButtonLabel = (card: CardCreateProgress): string =>
    cardCreateStarted(card)
        ? `Create the remaining ${card.to_create}`
        : `Create ${plural(card.to_create, "expense", "expenses")}`;

/** Where Create stands, from the lines; null before it has started. */
export const cardCreateProgress = (card: CardCreateProgress): string | null => {
    const of = `${card.created} of ${card.spends} created.`;
    if (card.create_running) return `Creating… ${of}`;
    if (!cardCreateStarted(card)) return null;
    if (card.to_create === 0) return `All ${plural(card.created, "expense", "expenses")} created, at Paid.`;
    if (card.failed > 0)
        return `${of} ${card.failed} could not be created: press Create again to retry ${card.failed === 1 ? "it" : "them"}.`;
    const waiting = card.to_create;
    return `${of} ${waiting} ${waiting === 1 ? "is" : "are"} waiting: press Create again to create ${waiting === 1 ? "it" : "them"}.`;
};

/** What the badge beside a spend's type says: "Check" for the fallback nobody has chosen, else its source. */
export const typeChoiceLabel = (line: Pick<CardImportLine, "type_source" | "check">): string | null =>
    line.check ? "Check" : line.type_source ?? null;

const TYPE_SOURCE_TITLES: Record<string, string> = {
    "Earlier statement": "Confirmed for this merchant on an earlier statement.",
    AI: "Suggested by AI from the live type list.",
    Fallback: "Fallback: nothing better was known for this merchant. Check it.",
    "Chosen on Review": "Chosen on Review.",
};

/** The badge's title: where the type came from, in a sentence (the "Check" badge is the fallback). */
export const typeSourceTitle = (line: Pick<CardImportLine, "type_source">): string | null =>
    (line.type_source && TYPE_SOURCE_TITLES[line.type_source]) || null;

/**
 * Give `line`'s type to every spend of its merchant Review may still retype (#1569): offered on a retypable
 * spend whose type is not the unchosen fallback ("Check") and whose merchant has another retypable spend of
 * a different type. `rows` includes `line` itself.
 */
export const merchantRetype = (
    lines: readonly CardImportLine[],
    line: CardImportLine,
): { rows: string[]; expenseType: string; label: string } | null => {
    if (!line.editable || line.is_credit || line.check || !line.merchant || !line.expense_type) return null;
    const same = lines.filter((other) => other.editable && !other.is_credit && other.merchant === line.merchant);
    if (!same.some((other) => other.expense_type !== line.expense_type)) return null;
    return {
        rows: same.map((other) => other.name),
        expenseType: line.expense_type,
        label: `Use for all ${same.length} ${line.merchant} spends`,
    };
};
