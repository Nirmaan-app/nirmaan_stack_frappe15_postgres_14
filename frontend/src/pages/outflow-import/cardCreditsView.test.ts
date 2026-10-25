// Review's split of a card statement's lines (#1567): the lines still to work, and the lines sorted out at
// upload, each with its reason.
import { describe, expect, it } from "vitest";

import { cardSkippedLines, cardWorkLines, cardSkippedSummary } from "./cardCreditsView";
import type { CardImportLine } from "./creditCardImport";

const line = (over: Partial<CardImportLine>): CardImportLine => ({
    name: "OFR-1",
    serno: "14099237561",
    date: "2026-09-02",
    details: "MAKEMYTRIP INDIA PVT NEW DELHI IN",
    amount: 11935,
    is_credit: false,
    row_status: "Pending match run",
    skip_kind: null,
    skip_reason: null,
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
    line({ name: "C", is_credit: true, row_status: "Mismatched", details: "MAKEMYTRIP(INDIA) P Gurgaon IN" }),
    line({
        name: "D",
        is_credit: true,
        row_status: "Skipped",
        skip_kind: "Card cashback",
        skip_reason: "Card cashback from the bank.",
    }),
];

describe("Review's lines", () => {
    it("★ the work: every line not skipped, the open credit too, in statement order", () => {
        expect(cardWorkLines({ lines }).map((l) => l.name)).toEqual(["A", "C"]);
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
