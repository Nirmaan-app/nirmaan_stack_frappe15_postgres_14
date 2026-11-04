// src/pages/outflow-import/cashbookCollect.ts
//
// What Review says about a statement's Collect payments (#1595, spec #1585). Pure: no React, no fetch.
// `CollectPaymentsReview` renders it; `cashbookCollect.test.ts` pins it.

/** A Collect payment the import leaves open for a person to decide (preview `collect_payments`). */
export interface CollectPaymentLine {
    row_number: number;
    transfer_id: string;
    amount: number;
    remarks: string;
    beneficiary_name: string;
    spent_by: string;
    /** The server's highlight: "Shop-requested payment, check it." */
    reason: string;
}

/** The preview's Collect payments; none from a server that predates them. */
export const collectPaymentsOf = (preview: { collect_payments?: CollectPaymentLine[] }): CollectPaymentLine[] =>
    preview.collect_payments ?? [];

/** The heading over Review's Collect payments, or null when there are none. */
export const collectPaymentsHeading = (lines: CollectPaymentLine[]): string | null => {
    if (lines.length === 0) return null;
    const n = lines.length.toLocaleString("en-IN");
    return lines.length === 1
        ? "1 shop-requested payment to check. It is not recorded: it stays open on the main table for Create expense or Skip by hand."
        : `${n} shop-requested payments to check. They are not recorded: they stay open on the main table for Create expense or Skip by hand.`;
};
