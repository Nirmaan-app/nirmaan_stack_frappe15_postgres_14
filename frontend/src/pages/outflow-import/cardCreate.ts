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
    "spends" | "created" | "failed" | "to_create" | "create_running" | "discardable"
>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Create has started: its job is queued or running, or it has written (Discard is gone from then on). */
export const cardCreateStarted = (card: CardCreateProgress | null | undefined): boolean =>
    Boolean(card && (card.create_running || !card.discardable));

/** The dialog polls while the Create job is queued or running. */
export const cardPolling = (card: Pick<CardImport, "create_running"> | null | undefined): boolean =>
    Boolean(card?.create_running);

/**
 * Create is offered while spends are left to create (waiting, failed on a run, or reopened by Unreconcile)
 * and its job is not running.
 */
export const canCreateCard = (card: CardCreateProgress): boolean => !card.create_running && card.to_create > 0;

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
