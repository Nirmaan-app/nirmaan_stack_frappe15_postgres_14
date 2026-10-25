import { describe, expect, it } from "vitest";

import {
    canCancelCheques,
    cancelNote,
    cancelNoteProblem,
    paidLineCancelProblem,
    paymentsRejectedByCancel,
    todayISO,
} from "./chequeStatus";

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

describe("paidLineCancelProblem", () => {
    // Owner, 2026-10-22: a cheque with a line already Paid cannot be cancelled (an Old-type cheque may have one).
    it("names the first line already Paid, a payment or an expense", () => {
        const line = (payment_doctype: string, payment_name: string, payment_status: string) =>
            ({ payment_doctype, payment_name, payment_status, amount: 1 });
        expect(
            paidLineCancelProblem([
                line("Project Payments", "PAY-1", "Reconciliation Pending"),
                line("Non Project Expenses", "NPE-1", "Paid"),
                line("Project Payments", "PAY-2", "Paid"),
            ]),
        ).toBe("expense NPE-1 on it is already Paid, so the money has left the bank");
        expect(paidLineCancelProblem([line("Project Payments", "PAY-2", "Paid")])).toBe(
            "payment PAY-2 on it is already Paid, so the money has left the bank",
        );
    });

    it("lets a cheque with no Paid line be cancelled", () => {
        expect(
            paidLineCancelProblem([
                { payment_doctype: "Project Payments", payment_name: "PAY-1", payment_status: "Rejected", amount: 1 },
                { payment_doctype: null, payment_name: null, payment_status: null, amount: 2 },
            ]),
        ).toBeNull();
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
