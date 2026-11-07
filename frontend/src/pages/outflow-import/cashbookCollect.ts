// src/pages/outflow-import/cashbookCollect.ts
//
// What Review says about a statement's Collect payments (#1595, spec #1585). Pure: no React, no fetch.
// `CollectPaymentsReview` renders it; `cashbookCollect.test.ts` pins it. Also what the decide screen says about an
// open Collect payment's stored bill (#1642, `collectBillOutcome`).

import type { BillCheck } from "@/types/NirmaanStack/ExpenseBill";

import { isOpenCollectPaymentLine } from "./outflowImportStatus";

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

/** What the decide screen says about an open Collect payment's stored bill (#1642, spec #1637 story 20). */
export interface CollectBillOutcome {
    heading: "Invoice already available";
    /** What Create will lead to, from the Bill check kept on the line (`expense_bills.line_check`). */
    outcome: "Will be auto-approved" | "Will go to Pending Approval" | "Checking";
    /** The stored bill, for its link. */
    fileUrl: string;
}

const WAITS_FOR_A_PERSON: ReadonlySet<BillCheck> = new Set(["Mismatched", "Not read", "Not checked"]);

/**
 * The bill an open Collect payment already holds, and what Create will lead to: Matched is auto-approved;
 * Mismatched, Not read and Not checked go to Pending Approval; a bill still being read (or kept from before
 * #1642, which Create reads) is Checking. Null with no stored bill, or on any other line.
 */
export const collectBillOutcome = (row: {
    row_status: string;
    source?: string | null;
    row_kind?: string | null;
    stored_bill?: string | null;
    bill_check?: BillCheck | null;
}): CollectBillOutcome | null => {
    if (!isOpenCollectPaymentLine(row) || !row.stored_bill) return null;
    const known = { heading: "Invoice already available", fileUrl: row.stored_bill } as const;
    if (row.bill_check === "Matched") return { ...known, outcome: "Will be auto-approved" };
    if (row.bill_check && WAITS_FOR_A_PERSON.has(row.bill_check)) return { ...known, outcome: "Will go to Pending Approval" };
    return { ...known, outcome: "Checking" };
};
