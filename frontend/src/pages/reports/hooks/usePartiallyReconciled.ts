import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { formatISO } from "date-fns";

/**
 * **Partially Reconciled** -- the money an Outflow Report's `status = "Paid"` filter cannot see.
 *
 * A record in `Reconciliation Pending` is money that HAS left the bank, partly confirmed by bank
 * lines, but it is not Paid -- so none of it reaches the report's total. This is the confirmed
 * part, per report, so a summary can print `Total Paid + Partially Reconciled = Total`.
 *
 * ⚠️ FOR THE SUMMARY ONLY, NEVER THE TABLE (owner, 2026-09-23). The rows stay Paid records: a
 * part-reconciled record is not a transaction anybody can point at in that list, it is part of one
 * that is still open.
 *
 * ⚠️ THE RANGE IS APPLIED TO EACH RECORD'S NEWEST BANK LINE, ALL OR NOTHING (owner, 2026-09-24) --
 * these records carry no `payment_date` at all, so the newest line stands in for the date they
 * will get when they go Paid. The server owns the rule (`expense_links.latest_line_in_range`, read
 * by the Payments summary card too). No range = all time, which is what the reports' default
 * "ALL" means.
 */
export interface PartiallyReconciledItem {
    doctype: "Project Payments" | "Project Expenses" | "Non Project Expenses";
    name: string;
    /** The CONFIRMED part -- what the summary adds. Not the record's own amount (`bill_amount`). */
    amount: number;
    /** Set only for Project Payments -- an expense has no order and so no GST rate. */
    document_type: string | null;
    document_name: string | null;
    // --- for the "Partially Reconciled" dialog ---
    bill_amount: number;
    /** `bill_amount - amount`: what no bank line has covered yet. */
    pending_amount: number;
    /** The newest bank line's date -- the one the range was tested against. */
    latest_line_date: string | null;
    line_count: number;
    project: string | null;
    project_name: string | null;
    type: string | null;
    description: string | null;
}

export interface PartiallyReconciledFigure {
    amount: number;
    /** RECORDS, not bank lines: one record several lines part-cover counts once. */
    count: number;
    /**
     * The same money per record, carrying the PO/WO reference where there is one.
     *
     * ⚠️ IT EXISTS FOR THE **Estimated (Excl. GST)** FIGURE, which divides each row by its
     * order's effective GST -- a rate that lives on the order and is only readable on the client
     * (`useOrderTotals.getEffectiveGST`). Applying that per record here is what keeps the added
     * figure on the same footing as the table's own rows.
     */
    items: PartiallyReconciledItem[];
}

interface PartiallyReconciledResponse {
    message: { project: PartiallyReconciledFigure; non_project: PartiallyReconciledFigure };
}

const asDate = (d?: Date) => (d ? formatISO(d, { representation: "date" }) : undefined);

export const usePartiallyReconciled = (
    report: "project" | "non_project",
    startDate?: Date,
    endDate?: Date
): PartiallyReconciledFigure => {
    // Both ends or neither: a half-open range would silently read as all time on one side.
    const params = useMemo(() => {
        const from = asDate(startDate);
        const to = asDate(endDate);
        return from && to ? { from_date: from, to_date: to } : {};
    }, [startDate, endDate]);

    const { data } = useFrappeGetCall<PartiallyReconciledResponse>(
        "nirmaan_stack.api.reports.partially_reconciled.get_partially_reconciled",
        params,
        `partially-reconciled-${params.from_date ?? "all"}-${params.to_date ?? "all"}`
    );

    // ⚠️ NORMALISED FIELD BY FIELD, NOT `?? EMPTY` ON THE WHOLE OBJECT. That only covers a
    // figure that is missing entirely. A response that HAS the figure but not `items` -- a server
    // still running the version before `items` existed, a cached body from that version, a partial
    // payload -- slips straight through, and `items.reduce` then throws on the next render. This is
    // a summary tile: it must fall back to a zero, never take the report down.
    const figure = data?.message?.[report];
    return useMemo(() => ({
        amount: figure?.amount ?? 0,
        count: figure?.count ?? 0,
        items: figure?.items ?? [],
    }), [figure]);
};
