// src/pages/outflow-import/cashbookCredits.ts
//
// The Wallet Credits on the Cashbook import's Review, as pure data (#1720, ADR-0015 Amendment E): money paid into the
// wallet from outside, booked at minus its Credit where its remark places it. No React, no fetch.
// GLOSSARY: *Wallet credit expense*.

import { formatCount, type CashbookMoneyInLine } from "./cashbookPreview";

/** The heading over the Wallet Credits, or null when there are none. */
export const creditsHeading = (lines: readonly CashbookMoneyInLine[] | undefined): string | null => {
    const n = lines?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 wallet credit (money paid in from outside) will be booked as a minus expense"
        : `${formatCount(n)} wallet credits (money paid in from outside) will be booked as minus expenses`;
};

/** "Wallet Credit PTM… · site scrap amount · Project Expenses · Telus GIFT City · Petty Cash". */
export const creditLabel = (line: CashbookMoneyInLine): string =>
    [
        `${line.row_kind || "Wallet Credit"} ${line.transfer_id}`,
        line.remarks,
        line.ledger,
        line.project_name,
        line.expense_type,
    ]
        .filter(Boolean)
        .join(" · ");
