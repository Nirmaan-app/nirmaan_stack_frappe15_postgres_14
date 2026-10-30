/**
 * Pending Invoices Upload -> PO / WO: the figures of the summary card above each table.
 *
 * The card totals exactly the rows its table shows after search and filters, so its count is the table's row
 * count and its Pending Invoice Amt is the sum of the table's own Pending Invoice Amt column. The basis is
 * what an order owes an invoice for: Amt Delivered on the PO side, Amt Paid on the WO side (`POReports`).
 */

/** One order's figures, as its table row shows them. */
export interface PendingUploadOrderFigures {
    totalAmount: number;
    invoiceAmount: number;
    /** Amt Delivered (PO) or Amt Paid (WO). */
    basisAmount: number;
}

export interface PendingUploadOrderSummary extends PendingUploadOrderFigures {
    count: number;
    /** basisAmount − invoiceAmount: the same sum as the table's Pending Invoice Amt column. */
    pendingAmount: number;
}

/** The card's totals over the rows the table shows. */
export const summarisePendingUploadOrders = (rows: PendingUploadOrderFigures[]): PendingUploadOrderSummary => {
    let totalAmount = 0;
    let invoiceAmount = 0;
    let basisAmount = 0;
    for (const r of rows) {
        totalAmount += r.totalAmount;
        invoiceAmount += r.invoiceAmount;
        basisAmount += r.basisAmount;
    }
    return {
        count: rows.length,
        totalAmount,
        invoiceAmount,
        basisAmount,
        pendingAmount: basisAmount - invoiceAmount,
    };
};

/** `part` as a whole-number percentage of `whole` ("48%"), or "" when there is no whole to compare with. */
export const percentOf = (part: number, whole: number): string =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "";
