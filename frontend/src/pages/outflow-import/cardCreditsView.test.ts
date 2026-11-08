// Review's split of a card statement's lines (#1567): the lines still to work, and the lines sorted out at
// upload, each with its reason.
import { describe, expect, it } from "vitest";

import {
    cardInternalTransferLines,
    cardRefundLines,
    cardSkippedLines,
    cardSkippedSummary,
    cardWorkLines,
} from "./cardCreditsView";
import type { CardImportLine } from "./creditCardImport";

const line = (over: Partial<CardImportLine>): CardImportLine => ({
    name: "OFR-1",
    serno: "14099237561",
    date: "2026-09-02",
    details: "MAKEMYTRIP INDIA PVT NEW DELHI IN",
    merchant: "MAKEMYTRIP",
    amount: 11935,
    is_credit: false,
    row_status: "Pending match run",
    skip_kind: null,
    skip_reason: null,
    expense_type: null,
    type_source: null,
    check: false,
    editable: false,
    is_refund: false,
    expense: null,
    outcome_note: null,
    ...over,
});

const lines = [
    line({ name: "A" }),
    line({
        name: "B",
        is_credit: true,
        details: "UPI Payment Received",
        row_status: "Skipped",
        skip_kind: "Card payment received",
        skip_reason: "Card payment received. Money paid into the card to clear its bill.",
    }),
    // An unpaired card refund (#1673): Create's work, listed under Refunds.
    line({
        name: "C",
        is_credit: true,
        is_refund: true,
        row_status: "Pending match run",
        details: "MAKEMYTRIP(INDIA) P Gurgaon IN",
    }),
    line({
        name: "D",
        is_credit: true,
        row_status: "Skipped",
        skip_kind: "Card cashback",
        skip_reason: "Card cashback from the bank.",
    }),
];

describe("Review's lines", () => {
    it("★ the work: every spend not skipped, in statement order; the refund is listed on its own", () => {
        expect(cardWorkLines({ lines }).map((l) => l.name)).toEqual(["A"]);
        expect(cardRefundLines({ lines }).map((l) => l.name)).toEqual(["C"]);
    });

    it("a refund pair's credit is skipped, never listed as a refund", () => {
        const pair = line({ name: "P", is_credit: true, is_refund: true, row_status: "Skipped", skip_kind: "Card refund pair" });
        expect(cardRefundLines({ lines: [pair] })).toEqual([]);
        expect(cardSkippedLines({ lines: [pair] }).map((l) => l.name)).toEqual(["P"]);
    });

    it("★ the skipped lines, each with its kind and reason", () => {
        expect(cardSkippedLines({ lines }).map((l) => [l.name, l.skip_kind, l.skip_reason])).toEqual([
            ["B", "Card payment received", "Card payment received. Money paid into the card to clear its bill."],
            ["D", "Card cashback", "Card cashback from the bank."],
        ]);
    });

    it("says how many were skipped and why", () => {
        expect(cardSkippedSummary({ lines })).toBe("2 lines skipped: 1 Card payment received, 1 Card cashback");
        expect(cardSkippedSummary({ lines: [lines[0]] })).toBeNull();
    });
});

describe("the auto-debit credit (#1624)", () => {
    const withAutoDebit = [
        ...lines,
        line({
            name: "E",
            is_credit: true,
            details: "Autodebit Payment Recd.",
            row_status: "Internal Transfer",
            outcome_note: "Internal Transfer from ICICI Current Account to ICICI Credit Card (Card ending 1111).",
        }),
    ];

    it("is listed under Internal transfers, not as work and not as skipped", () => {
        expect(cardInternalTransferLines({ lines: withAutoDebit }).map((l) => l.name)).toEqual(["E"]);
        expect(cardWorkLines({ lines: withAutoDebit }).map((l) => l.name)).toEqual(["A"]);
        expect(cardSkippedLines({ lines: withAutoDebit }).map((l) => l.name)).toEqual(["B", "D"]);
    });
});
