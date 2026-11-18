// src/pages/outflow-import/cashbookRefunds.ts
//
// The wallet refunds on the Cashbook import's Review (#1709, ADR-0015 Amendment D), as pure data. No React, no fetch.
// GLOSSARY: *Wallet refund expense*. Split out of `cashbookPreview.ts` (file size).

import type { CashbookSkippedRow } from "./cashbookPreview";

/**
 * An unpaired wallet refund: created at minus its Credit (`amount`) where its spend is booked. `refund_of` is the
 * spend's Txn Id (blank when the refund names none); `reduces` the spend's existing Expense (blank when it has none);
 * `spend_on_statement` says this same import creates the spend's Expense.
 */
export interface CashbookRefundLine extends CashbookSkippedRow {
    refund_of: string;
    reduces: string;
    spend_on_statement: boolean;
    ledger: string;
    project_name: string;
    expense_type: string;
}

const count = (n: number): string => n.toLocaleString("en-IN");

/** The heading over the wallet refunds, or null when there are none. */
export const refundsHeading = (lines: readonly CashbookRefundLine[] | undefined): string | null => {
    const n = lines?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 wallet refund will be booked as a minus expense where its spend is booked"
        : `${count(n)} wallet refunds will be booked as minus expenses where their spends are booked`;
};

/** "Credit Adjustment REF-OBO… · reduces OBO… (9surl50t7h) · Non Project Expenses · Petty Cash". */
export const refundLabel = (line: CashbookRefundLine): string => {
    const where = line.reduces || (line.spend_on_statement ? "created by this import" : "no Expense yet");
    const spend = line.refund_of ? `reduces ${line.refund_of} (${where})` : "names no spend";
    return [`${line.row_kind || "Refund"} ${line.transfer_id}`, spend, line.ledger, line.project_name, line.expense_type]
        .filter(Boolean)
        .join(" · ");
};
