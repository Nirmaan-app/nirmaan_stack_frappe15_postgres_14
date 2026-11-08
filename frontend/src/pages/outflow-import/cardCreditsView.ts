// src/pages/outflow-import/cardCreditsView.ts
//
// Review's split of a Credit Card Statement's lines (#1567, spec #1565, ADR-0039 decision 4). Pure: no React.
// At upload the server sorts the credits: payments into the card and cashback are skipped by rule, a refund
// pair (a merchant credit and the spend it cancels) is skipped together, and any other merchant credit is an
// unpaired card refund (#1673), Create's work. `CardImportReview` lists the spends, the refunds under them, and,
// beneath, the skipped lines with the server's own reasons.

import type { CardImport, CardImportLine } from "./creditCardImport";

import { ROW_INTERNAL_TRANSFER as INTERNAL_TRANSFER, ROW_SKIPPED } from "./outflowImportStatus";

const listed = (line: CardImportLine) => line.row_status !== ROW_SKIPPED && line.row_status !== INTERNAL_TRANSFER;

/** The spends, in statement order (and any credit a person decides on the main table, which carries no plan). */
export const cardWorkLines = (card: Pick<CardImport, "lines">): CardImportLine[] =>
    card.lines.filter((line) => listed(line) && !line.is_refund);

/** The unpaired card refunds (#1673), in statement order: Review's Refunds list, under the spends. */
export const cardRefundLines = (card: Pick<CardImport, "lines">): CardImportLine[] =>
    card.lines.filter((line) => listed(line) && line.is_refund);

/**
 * The bank's auto-debit paying the card (#1624): Internal Transfer lines, each with its note naming From, To and
 * the card. Listed on their own, like the main table's Internal Transfers tab, never with the skipped lines.
 */
export const cardInternalTransferLines = (card: Pick<CardImport, "lines">): CardImportLine[] =>
    card.lines.filter((line) => line.row_status === INTERNAL_TRANSFER);

/** The lines sorted out at upload (or skipped since), each carrying its kind and reason. */
export const cardSkippedLines = (card: Pick<CardImport, "lines">): CardImportLine[] =>
    card.lines.filter((line) => line.row_status === ROW_SKIPPED);

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
