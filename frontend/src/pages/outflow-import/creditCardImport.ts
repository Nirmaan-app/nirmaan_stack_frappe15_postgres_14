// src/pages/outflow-import/creditCardImport.ts
//
// The Credit Card Statement import's view logic, as pure data (#1566, spec #1565, ADR-0037). No React, no
// fetch, no DOM. `CardImportReview` renders it; `creditCardImport.test.ts` pins it. Later slices of spec
// #1565 (credit sorting, type suggestion, create) extend THIS module.

import { format, parseISO } from "date-fns";

/** The source string. The parser adapter key and the batch Select option, pinned by test. */
export const CARD_SOURCE = "ICICI Credit Card Statement";

export const CARD_UPLOAD_URL = "/api/method/nirmaan_stack.api.outflow_import.card_import.upload_card_statement";
export const CARD_IMPORT_METHOD = "nirmaan_stack.api.outflow_import.card_import.get_card_import";
export const CARD_DISCARD_METHOD = "nirmaan_stack.api.outflow_import.card_import.discard_card_import";

/** The URL parameter that holds the card import the dialog is showing, so a reload reopens it. */
export const CARD_URL_KEY = "card";

/** Whether a statement of this `source` is a Credit Card Statement import. */
export const isCardImport = (source: string | null | undefined): boolean => (source ?? "").trim() === CARD_SOURCE;

/**
 * Whether choosing `batch` from a list of statements (the Import selector, Import History) opens the card
 * dialog rather than pinning the table to it. A card import's lines are not bank lines: pinned, the table
 * shows nothing.
 */
export const opensCardDialog = (
    batch: string | undefined,
    options: readonly { name: string; source?: string | null }[],
): boolean => Boolean(batch) && isCardImport(options.find((option) => option.name === batch)?.source);

/** One statement line, as Review lists it. */
export interface CardImportLine {
    name: string;
    serno: string;
    date: string | null;
    details: string;
    /** The cleaned merchant name (one per merchant, whatever the bank's spelling); null on a credit. */
    merchant: string | null;
    amount: number;
    is_credit: boolean;
    row_status: string;
    /** A skipped line's Skip Type and the server's reason (#1567); null on a line still to work. */
    skip_kind: string | null;
    skip_reason: string | null;
    /** A spend's expense type (#1568); null on a credit. */
    expense_type: string | null;
    /** Where the type came from: Earlier statement, AI, Fallback, Chosen on Review; null on a credit. */
    type_source: string | null;
    /** The fallback type nobody has chosen yet: Review marks it "Check". */
    check: boolean;
    /** A spend Create would still write, so Review may still retype it. */
    editable: boolean;
    /** The Non Project Expense Create made, once it has. */
    expense: string | null;
    outcome_note: string | null;
}

/** The statement's own summary, as `Credit Card Statement` stores it. */
export interface CardTotals {
    previous_balance: number;
    purchases_charges: number;
    cash_advances: number;
    payments_credits: number;
    total_amount_due: number;
}

/** What `upload_card_statement` and `get_card_import` return: one shape for both. */
export interface CardImport {
    batch: string;
    source: string;
    statement: string | null;
    original_filename: string;
    holder: string | null;
    company: string | null;
    statement_date: string | null;
    period_from: string | null;
    period_to: string | null;
    statement_file: string | null;
    totals: CardTotals;
    spends: number;
    credits: number;
    spends_total: number;
    /** Lines whose SerNo an earlier import holds, left out of this one. */
    repeats_not_saved: number;
    /** Create has written nothing, so Discard is possible. Who may discard is the screen's question. */
    discardable: boolean;
    /** Create (#1568): spends created, failed on the last run, still to create; its job queued or running. */
    created: number;
    failed: number;
    to_create: number;
    create_running: boolean;
    /** The type suggestion (#1569) is queued or running: Review polls, and Create waits. */
    suggest_running: boolean;
    /** The live Non-Project expense types, the only ones Review offers. */
    expense_types: string[];
    lines: CardImportLine[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const day = (value: string | null | undefined) => (value ? format(parseISO(value), "dd-MMM-yyyy") : "—");

/** The one line that tells the accountant what the statement holds. */
export const cardCountsLine = (card: Pick<CardImport, "spends" | "credits" | "repeats_not_saved">): string => {
    const parts = [plural(card.spends, "spend", "spends"), plural(card.credits, "credit", "credits")];
    if (card.repeats_not_saved > 0)
        parts.push(`${plural(card.repeats_not_saved, "line", "lines")} already imported left out`);
    return parts.join(" · ");
};

/** The statement's five summary totals, labelled and ordered as the statement prints them. */
export const cardTotalsRows = (card: Pick<CardImport, "totals">): { label: string; amount: number }[] => [
    { label: "Previous Balance", amount: card.totals.previous_balance },
    { label: "Purchases / Charges", amount: card.totals.purchases_charges },
    { label: "Cash Advances", amount: card.totals.cash_advances },
    { label: "Payments / Credits", amount: card.totals.payments_credits },
    { label: "Total Amount Due", amount: card.totals.total_amount_due },
];

/** The billing period, `dd-MMM-yyyy to dd-MMM-yyyy`. */
export const cardPeriodLabel = (card: Pick<CardImport, "period_from" | "period_to">): string =>
    `${day(card.period_from)} to ${day(card.period_to)}`;

/** A date as every screen shows it. */
export const cardDay = day;

/** What an Import History row is titled by: the card holder (with the period beneath), else the file. */
export const cardHistoryTitle = (option: {
    name: string;
    card_holder?: string | null;
    original_filename?: string | null;
}): string => option.card_holder || option.original_filename || option.name;

/** What the import has done, in words: nothing created yet. */
export const CARD_UPLOADED_NOTE =
    "Uploaded and checked: every line adds up to the statement's own totals. Nothing has been created yet.";

/**
 * Discard is offered to an Admin or Accountant Lead (`canUndo`) on an import Create has written nothing to
 * (`discardable`, the server's verdict). The server asks every rule again.
 */
export const canDiscardCard = (card: Pick<CardImport, "discardable">, canUndo: boolean): boolean =>
    canUndo && card.discardable === true;

/** The confirmation: the import, what goes with it, and that the statement can be uploaded again. */
export const cardDiscardConfirmation = (
    card: Pick<CardImport, "batch" | "holder" | "period_from" | "period_to" | "spends" | "credits">,
): string =>
    `Discard ${card.batch}? This deletes ${card.holder ?? "the holder"}'s statement for ${cardPeriodLabel(card)}, ` +
    `its ${plural(card.spends + card.credits, "line", "lines")} and its PDF. Nothing was created from it, so ` +
    "nothing else changes. You can upload the statement again afterwards.";
