// The hand actions on an Internal Transfer (#1626, spec #1619): which line offers Mark as Internal Transfer, the
// line's own side, the other ends offered, and the "by hand" line. Mirrors `internal_transfer_rules.py`.
import { describe, expect, it } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

import {
    INTERNAL_TRANSFER_PLACES,
    canMarkInternalTransfer,
    canSendBack,
    markedByHandLine,
    otherEndChoices,
    ownPlace,
} from "./internalTransferView";

const row = (over: Partial<OutflowImportRow>): OutflowImportRow =>
    ({ name: "OFR-1", source: "ICICI Bank Statement", row_status: "Mismatched", direction: "Debit", ...over }) as OutflowImportRow;

describe("the places (parity with internal_transfers.PLACES)", () => {
    it("is the fixed list of seven", () => {
        expect(INTERNAL_TRANSFER_PLACES).toEqual([
            "ICICI Current Account",
            "ICICI Bank Ledger",
            "Cashfree Wallet",
            "Cashbook Virtual Account",
            "Cashbook Employee Wallet",
            "Porter Wallet",
            "ICICI Credit Card",
        ]);
    });
});

describe("Mark as Internal Transfer", () => {
    it("is offered on an open ICICI, Cashfree or Cashbook line", () => {
        expect(canMarkInternalTransfer(row({}))).toBe(true);
        expect(canMarkInternalTransfer(row({ source: "Cashfree", row_status: "Pending match run", direction: "" }))).toBe(true);
        expect(canMarkInternalTransfer(row({ source: "Cashbook", row_status: "Mismatched", direction: "" }))).toBe(true);
    });

    it("is not offered on a Porter line, a card line, a Cashbook line its job owns or a line that is not open", () => {
        expect(canMarkInternalTransfer(row({ source: "Porter Statement" }))).toBe(false);
        expect(canMarkInternalTransfer(row({ source: "ICICI Credit Card Statement" }))).toBe(false);
        expect(canMarkInternalTransfer(row({ source: "Cashbook", row_status: "Pending match run" }))).toBe(false);
        for (const status of ["Settled", "Partially Allocated", "Skipped", "Internal Transfer"]) {
            expect(canMarkInternalTransfer(row({ row_status: status }))).toBe(false);
        }
    });

    it("fills the line's own side from its source and offers every other place as the other end", () => {
        expect(ownPlace("Cashbook")).toBe("Cashbook Employee Wallet");
        expect(otherEndChoices(row({}))).not.toContain("ICICI Current Account");
        expect(otherEndChoices(row({}))).toHaveLength(6);
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
                    transfer_made_by: "by hand",
                    transfer_marked_by: "lead@example.com",
                    transfer_marked_at: "2026-11-06 10:00:00",
                    transfer_mark_reason: "Porter top-up the rule missed",
                })
            )
        ).toBe("Marked by hand · lead@example.com · 06-Nov-2026 · Porter top-up the rule missed");
        expect(markedByHandLine(row({ transfer_made_by: "platform_cashfree" }))).toBeNull();
    });
});
