// src/pages/outflow-import/cardCreate.ts
//
// Review the card spends' types, then Create (#1568, spec #1565, ADR-0039): pure view logic. No React, no
// fetch. `CardImportReview` and `ImportStatementDialog` render it; `cardCreate.test.ts` pins it. The server
// (`card_review.py`, `card_create.py`) asks every rule again.

import formatToIndianRupee, { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";

import type { CardImport, CardImportLine } from "./creditCardImport";
import { ROW_INTERNAL_TRANSFER, ROW_SETTLED, ROW_SKIPPED } from "./outflowImportStatus";
import { plural } from "./porterWords";

export const CARD_CREATE_METHOD = "nirmaan_stack.api.outflow_import.card_create.create_card_expenses";
export const CARD_SET_TYPE_METHOD = "nirmaan_stack.api.outflow_import.card_review.set_card_expense_type";

/** How often the dialog re-reads the import while the Create job is queued or running. */
export const CARD_CREATE_POLL_MS = 2000;

export type CardCreateProgress = Pick<
    CardImport,
    | "spends"
    | "refunds"
    | "created"
    | "failed"
    | "to_create"
    | "spends_to_create"
    | "refunds_to_create"
    | "create_running"
    | "suggest_running"
    | "discardable"
>;

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

/** What Create will write: "39 expenses and 1 refund", leaving out a count of nought (#1673). */
const toCreateWords = (card: CardCreateProgress): string =>
    [
        card.spends_to_create > 0 ? plural(card.spends_to_create, "expense", "expenses") : null,
        card.refunds_to_create > 0 ? plural(card.refunds_to_create, "refund", "refunds") : null,
    ]
        .filter(Boolean)
        .join(" and ");

export const cardCreateButtonLabel = (card: CardCreateProgress): string =>
    cardCreateStarted(card) ? `Create the remaining ${toCreateWords(card)}` : `Create ${toCreateWords(card)}`;

/**
 * Where the import stands, as the dialog shows it (#1674). One phase, derived from the import alone, so a reload
 * or a reopen from Import History shows the same thing:
 *
 *   review        Create not started
 *   creating      its job is queued or running: "Creating… N of M" and a bar
 *   finished      nothing left to create: a green "Import finished" banner, and Done is the only button
 *   needs_create  Create ran and some lines failed or still wait: how many, and Create offered again
 */
export type CardPhase = "review" | "creating" | "finished" | "needs_create";

export interface CardPhaseView {
    phase: CardPhase;
    /** While Create runs: the line and the bar's percent. */
    progress: { label: string; percent: number } | null;
    /** Once finished: the banner's title and its counts, one per line. */
    banner: { title: string; lines: string[] } | null;
    /** When another Create is needed: how many lines failed or wait. */
    notice: string | null;
    /** The footer: Create's label (null when not offered), whether Discard may show (who may discard is the
     *  button's own question), and whether Done is the main button or a plain one beside Create. */
    footer: { create: string | null; discard: boolean; done: "primary" | "outline" };
}

export const cardPhase = (card: CardCreateProgress): CardPhase => {
    if (card.create_running) return "creating";
    if (!cardCreateStarted(card)) return "review";
    return card.to_create === 0 ? "finished" : "needs_create";
};

/** The Finished banner's counts, from the lines as the server reports them. */
const finishedLines = (lines: readonly CardImportLine[]): string[] => {
    const created = lines.filter((line) => line.row_status === ROW_SETTLED);
    const spends = created.filter((line) => !line.is_credit);
    const refunds = created.filter((line) => line.is_refund);
    const sum = (items: CardImportLine[]) => items.reduce((total, line) => total + line.amount, 0);
    const skipped = lines.filter((line) => line.row_status === ROW_SKIPPED).length;
    const internal = lines.filter((line) => line.row_status === ROW_INTERNAL_TRANSFER).length;
    return [
        `${plural(spends.length, "expense", "expenses")} created, ${formatToIndianRupeeOrZero(sum(spends))}`,
        refunds.length > 0 ? `${plural(refunds.length, "refund", "refunds")} recorded, -${formatToIndianRupee(sum(refunds))}` : null,
        skipped > 0 ? `${plural(skipped, "line", "lines")} skipped` : null,
        internal > 0 ? plural(internal, "internal transfer", "internal transfers") : null,
    ].filter((part): part is string => part !== null);
};

export const cardPhaseView = (card: CardCreateProgress & Pick<CardImport, "lines">): CardPhaseView => {
    const phase = cardPhase(card);
    const total = card.created + card.to_create;
    const create = canCreateCard(card) ? cardCreateButtonLabel(card) : null;
    const view: CardPhaseView = {
        phase,
        progress: null,
        banner: null,
        notice: null,
        footer: { create, discard: phase === "review" && card.discardable, done: create ? "outline" : "primary" },
    };
    if (phase === "creating") {
        view.progress = {
            label: `Creating… ${card.created} of ${total}`,
            percent: total > 0 ? Math.round((card.created / total) * 100) : 0,
        };
        view.footer.done = "outline";
    } else if (phase === "finished") {
        view.banner = { title: "Import finished", lines: finishedLines(card.lines) };
    } else if (phase === "needs_create") {
        const of = `${card.created} of ${total} created.`;
        const left = card.to_create;
        view.notice =
            card.failed > 0
                ? `${of} ${plural(card.failed, "line", "lines")} could not be created: press Create again to retry ${card.failed === 1 ? "it" : "them"}.`
                : `${of} ${plural(left, "line", "lines")} still ${left === 1 ? "waits" : "wait"}: press Create again to create ${left === 1 ? "it" : "them"}.`;
    }
    return view;
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
 * Every spend of `line`'s merchant Review may still retype, `line` included, when there is more than one
 * (story 29): Review's type picker then offers "this spend" or all of them, so ten lines of one merchant take
 * one choice, the fallback ("Check") ones too. Null on a credit (a refund is typed on its own, #1673), a spend
 * Create has written, or a merchant with one retypable spend. A refund is never among the rows.
 */
export const merchantScope = (
    lines: readonly CardImportLine[],
    line: CardImportLine,
): { rows: string[]; label: string } | null => {
    if (!line.editable || line.is_credit || !line.merchant) return null;
    const same = lines.filter((other) => other.editable && !other.is_credit && other.merchant === line.merchant);
    if (same.length < 2) return null;
    return { rows: same.map((other) => other.name), label: `All ${same.length} ${line.merchant} spends` };
};

/**
 * Give `line`'s type to every spend of its merchant Review may still retype (#1569): offered on a retypable
 * spend whose type is not the unchosen fallback ("Check") and whose merchant has another retypable spend of
 * a different type. `rows` includes `line` itself.
 */
export const merchantRetype = (
    lines: readonly CardImportLine[],
    line: CardImportLine,
): { rows: string[]; expenseType: string; label: string } | null => {
    const scope = merchantScope(lines, line);
    if (!scope || line.check || !line.expense_type) return null;
    const byName = new Map(lines.map((other) => [other.name, other]));
    if (scope.rows.every((name) => byName.get(name)?.expense_type === line.expense_type)) return null;
    return {
        rows: scope.rows,
        expenseType: line.expense_type,
        label: `Use for all ${scope.rows.length} ${line.merchant} spends`,
    };
};
