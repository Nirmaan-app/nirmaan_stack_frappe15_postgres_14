// The hand actions on an Internal Transfer (#1626, spec #1619): which line offers Mark as Internal Transfer and Send
// back to Mismatched, the "by hand" line, and the heading the Cashbook preview and the card Review share. The places,
// the line's own side and the may-mark rule are the server's (`hand_mark`, pinned by `test_internal_transfer_actions`
// against `internal_transfers.PLACES`); nothing here copies them.
import { describe, expect, it } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

import {
    canMarkInternalTransfer,
    canSendBack,
    internalTransfersHeading,
    markedByHandLine,
    recordsFilledText,
    recordsToFillText,
} from "./internalTransferView";

const row = (over: Partial<OutflowImportRow>): OutflowImportRow =>
    ({ name: "OFR-1", source: "ICICI Bank Statement", row_status: "Mismatched", direction: "Debit", ...over }) as OutflowImportRow;

const offer = { own_place: "ICICI Current Account", other_ends: ["Porter Wallet"], detail: "" };

describe("Mark as Internal Transfer", () => {
    it("is offered exactly when the server sends the line's hand-mark offer", () => {
        expect(canMarkInternalTransfer(row({ hand_mark: offer }))).toBe(true);
        expect(canMarkInternalTransfer(row({ hand_mark: null }))).toBe(false);
        expect(canMarkInternalTransfer(row({}))).toBe(false);
    });
});

describe("Send back to Mismatched", () => {
    it("is offered on an Internal Transfer line only", () => {
        expect(canSendBack(row({ row_status: "Internal Transfer" }))).toBe(true);
        expect(canSendBack(row({ row_status: "Mismatched" }))).toBe(false);
    });

    it("a hand-marked record says who, when and why; a rule's says nothing", () => {
        expect(
            markedByHandLine(
                row({
                    transfer_marked_by: "lead@example.com",
                    transfer_marked_at: "2026-11-06 10:00:00",
                    transfer_mark_reason: "Porter top-up the rule missed",
                })
            )
        ).toBe("Marked by hand · lead@example.com · 06-Nov-2026 · Porter top-up the rule missed");
        expect(markedByHandLine(row({ transfer_made_by_label: "Rule: Cashfree wallet top-up" }))).toBeNull();
    });
});

describe("the Internal transfers heading (card Review and Cashbook preview)", () => {
    it("counts the lines, and is absent when there are none", () => {
        expect(internalTransfersHeading(1)).toBe("Internal transfers · 1 line");
        expect(internalTransfersHeading(3)).toBe("Internal transfers · 3 lines");
        expect(internalTransfersHeading(0)).toBeNull();
    });
});

describe("the re-upload fill, shown (owner decision 2, #1619)", () => {
    it("the preview says how many old records get their amount from this file", () => {
        expect(recordsToFillText(0)).toBeNull();
        expect(recordsToFillText(1)).toBe("1 old Internal Transfer record gets its amount from this file");
        expect(recordsToFillText(3)).toBe("3 old Internal Transfer records get their amount from this file");
    });

    it("the result after Create says how many were filled", () => {
        expect(recordsFilledText(0)).toBeNull();
        expect(recordsFilledText(1)).toBe("1 old Internal Transfer record got its amount from this file.");
        expect(recordsFilledText(2)).toBe("2 old Internal Transfer records got their amount from this file.");
    });
});
