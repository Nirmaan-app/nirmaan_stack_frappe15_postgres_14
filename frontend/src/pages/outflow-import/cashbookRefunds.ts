// src/pages/outflow-import/cashbookRefunds.ts
//
// The wallet refunds on the Cashbook import's Review, as pure data: the Paired wallet refunds (#1594) and the
// unpaired ones (#1709, ADR-0015 Amendment D). No React, no fetch.
// GLOSSARY: *Wallet refund expense*. Split out of `cashbookPreview.ts` (file size).

import { formatCount, type CashbookRefundLine, type CashbookRefundPair } from "./cashbookPreview";

/**
 * The heading over the wallet refunds, or null when there are none. A refund is booked where its spend is booked, or,
 * when the spend has no Expense, where its own remark places it (#1720 decision 3; wording #1715).
 */
export const refundsHeading = (lines: readonly CashbookRefundLine[] | undefined): string | null => {
    const n = lines?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 wallet refund will be booked as a minus expense: where its spend is booked, or else where its remark says"
        : `${formatCount(n)} wallet refunds will be booked as minus expenses: each where its spend is booked, or else ` +
              "where its remark says";
};

/** "Credit Adjustment REF-OBO… · reduces OBO… (9surl50t7h) · Non Project Expenses · Petty Cash". */
export const refundLabel = (line: CashbookRefundLine): string => {
    const where = line.reduces || (line.spend_on_statement ? "created by this import" : "no Expense yet");
    const spend = line.refund_of ? `reduces ${line.refund_of} (${where})` : "names no spend";
    return [`${line.row_kind || "Refund"} ${line.transfer_id}`, spend, line.ledger, line.project_name, line.expense_type]
        .filter(Boolean)
        .join(" · ");
};

/**
 * The heading over the Paired wallet refunds on Review (#1594), or null when there are none:
 * "2 paired wallet refunds: each refund gives back a whole spend, so neither line is recorded".
 */
export const pairsHeading = (pairs: readonly CashbookRefundPair[] | undefined): string | null => {
    const n = pairs?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 paired wallet refund: the refund gives back the whole spend, so neither line is recorded"
        : `${formatCount(n)} paired wallet refunds: each refund gives back a whole spend, so neither line is recorded`;
};

/** How a pair's spend reads beside its refund: "Collect Payment OBO…3 · Testshop Collect Three". */
export const pairSpendLabel = (pair: CashbookRefundPair): string =>
    [`${pair.spend.row_kind || "Spend"} ${pair.spend.transfer_id}`, pair.spend.beneficiary_name || pair.spend.remarks]
        .filter(Boolean)
        .join(" · ");
