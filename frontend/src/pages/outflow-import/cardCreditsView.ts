// src/pages/outflow-import/cardCreditsView.ts
//
// Review's split of a Credit Card Statement's lines (#1567, spec #1565, ADR-0039 decision 4). Pure: no React.
// At upload the server sorts the credits: payments into the card and cashback are skipped by rule, a refund
// pair (a merchant credit and the spend it cancels) is skipped together, and any other credit stays open.
// `CardImportReview` lists the work and, beneath it, the skipped lines with the server's own reasons.

import type { CardImport, CardImportLine } from "./creditCardImport";

const SKIPPED = "Skipped";

/** The lines still to work, in statement order: the spends, and any credit that stayed open. */
export const cardWorkLines = (card: Pick<CardImport, "lines">): CardImportLine[] =>
    card.lines.filter((line) => line.row_status !== SKIPPED);

/** The lines sorted out at upload (or skipped since), each carrying its kind and reason. */
export const cardSkippedLines = (card: Pick<CardImport, "lines">): CardImportLine[] =>
    card.lines.filter((line) => line.row_status === SKIPPED);

/** "6 lines skipped: 5 Card payment received, 1 Card cashback", or `null` when none was skipped. */
export const cardSkippedSummary = (card: Pick<CardImport, "lines">): string | null => {
    const skipped = cardSkippedLines(card);
    if (skipped.length === 0) return null;
    const counts = new Map<string, number>();
    for (const line of skipped) {
        const kind = line.skip_kind || "Skipped";
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const parts = [...counts].map(([kind, count]) => `${count} ${kind}`);
    return `${skipped.length} ${skipped.length === 1 ? "line" : "lines"} skipped: ${parts.join(", ")}`;
};
