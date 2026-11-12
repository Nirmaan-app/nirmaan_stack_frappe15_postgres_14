/**
 * Every reject in the approve dialog asks for a reason (2026-11-12). A PO / WO payment's reason is saved to
 * `rejection_reason` with the status; an approve never writes the field.
 */
import { describe, expect, it } from "vitest";

import { DIALOG_ACTION_TYPES } from "./constants";
import { rejectionFields, rejectNeedsReason, rejectReasonBox } from "./rejectReason";

const plain = { isExpense: false, onCheque: false, chequeLoading: false };

describe("rejectNeedsReason", () => {
    it("is true for a reject and false for an approve", () => {
        expect(rejectNeedsReason(DIALOG_ACTION_TYPES.REJECT)).toBe(true);
        expect(rejectNeedsReason(DIALOG_ACTION_TYPES.APPROVE)).toBe(false);
    });
});

describe("rejectReasonBox", () => {
    it("gives a PO / WO payment's reject its own reason box", () => {
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.REJECT, plain)).toBe("payment");
    });

    it("leaves a cheque's reject to the cheque block, which has its own box", () => {
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.REJECT, { ...plain, onCheque: true })).toBe("cheque");
    });

    it("leaves an expense's reject to the expense box", () => {
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.REJECT, { ...plain, isExpense: true })).toBe("expense");
    });

    it("draws no payment box while the cheque is still loading (it may turn out to be a cheque reject)", () => {
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.REJECT, { ...plain, chequeLoading: true })).toBeNull();
    });

    it("draws no box at all on an approve, whatever the row is", () => {
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.APPROVE, plain)).toBeNull();
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.APPROVE, { ...plain, onCheque: true })).toBeNull();
        expect(rejectReasonBox(DIALOG_ACTION_TYPES.APPROVE, { ...plain, isExpense: true })).toBeNull();
    });
});

describe("rejectionFields", () => {
    it("saves the trimmed reason with a reject", () => {
        expect(rejectionFields("Rejected", "  Rate not agreed  ")).toEqual({ rejection_reason: "Rate not agreed" });
    });

    it("never writes the field on an approve, so an approval cannot blank an old reason", () => {
        expect(rejectionFields("Approved", "anything")).toEqual({});
        expect(rejectionFields("CEO Pending", "anything")).toEqual({});
    });

    it("writes an empty string, not undefined, when no reason came through", () => {
        expect(rejectionFields("Rejected")).toEqual({ rejection_reason: "" });
    });
});
