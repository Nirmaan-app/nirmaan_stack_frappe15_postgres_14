import { describe, expect, it } from "vitest";

import { canCancelCheques, cancelNote, cancelNoteProblem, paymentsRejectedByCancel, todayISO } from "./chequeStatus";

describe("todayISO", () => {
    it("is the local day, zero-padded", () => {
        expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    });
});

describe("cancelNoteProblem", () => {
    it("asks for a note", () => {
        expect(cancelNoteProblem("   ")).toBe("Write a note saying why the cheque is cancelled.");
        expect(cancelNoteProblem("vendor lost it")).toBeNull();
    });
});

describe("paymentsRejectedByCancel", () => {
    it("lists every payment on the cheque that is not Rejected already", () => {
        const lines = [
            { payment_doctype: "Project Payments", payment_name: "PAY-1", payment_status: "Reconciliation Pending", amount: 1 },
            { payment_doctype: "Project Payments", payment_name: "PAY-2", payment_status: "Rejected", amount: 2 },
            { payment_doctype: null, payment_name: null, payment_status: null, amount: 3 },
            { payment_doctype: "Project Expenses", payment_name: "EXP-1", payment_status: "Approved", amount: 4 },
            { payment_doctype: "Project Payments", payment_name: "PAY-3", payment_status: "Requested", amount: 5 },
        ];
        expect(paymentsRejectedByCancel(lines).map((l) => l.payment_name)).toEqual(["PAY-1", "PAY-3"]);
    });
});

describe("cancelNote", () => {
    it("says how many payments become Rejected", () => {
        expect(cancelNote("004521", 3)).toMatch(/^All 3 payments become Rejected, and cheque 004521 becomes Cancelled/);
        expect(cancelNote("004521", 1)).toMatch(/^Its payment becomes Rejected/);
        expect(cancelNote("004521", 0)).toMatch(/^No payment changes/);
    });
});

describe("canCancelCheques", () => {
    it("lets accounts cancel, never procurement", () => {
        expect(canCancelCheques("Nirmaan Accountant Profile")).toBe(true);
        expect(canCancelCheques("Nirmaan Accountant Lead Profile")).toBe(true);
        expect(canCancelCheques("Nirmaan Admin Profile")).toBe(true);
        expect(canCancelCheques("Nirmaan Procurement Executive Profile")).toBe(false);
        expect(canCancelCheques("Nirmaan Project Manager Profile")).toBe(false);
    });
});
