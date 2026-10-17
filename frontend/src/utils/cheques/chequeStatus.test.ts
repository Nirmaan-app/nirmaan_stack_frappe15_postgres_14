import { describe, expect, it } from "vitest";

import {
    bulkClearText,
    canClearOrCancel,
    cancelNote,
    cancelNoteProblem,
    clearanceDateOf,
    clearanceDateProblem,
    offersBankLines,
    paymentsRejectedByCancel,
    todayISO,
} from "./chequeStatus";

describe("clearanceDateProblem", () => {
    it("asks for a date", () => {
        expect(clearanceDateProblem("", "2026-10-01", "2026-10-17")).toBe("Choose the clearance date.");
    });

    it("refuses a day after today or before the cheque was issued", () => {
        expect(clearanceDateProblem("2026-10-18", "2026-10-01", "2026-10-17")).toBe(
            "The clearance date cannot be after today.",
        );
        expect(clearanceDateProblem("2026-09-30", "2026-10-01", "2026-10-17")).toBe(
            "The clearance date cannot be before the cheque was issued (01-10-2026).",
        );
    });

    it("takes any day from the issue date to today", () => {
        expect(clearanceDateProblem("2026-10-01", "2026-10-01", "2026-10-17")).toBeNull();
        expect(clearanceDateProblem("2026-10-17", "2026-10-01 00:00:00", "2026-10-17")).toBeNull();
        expect(clearanceDateProblem("2026-01-01", null, "2026-10-17")).toBeNull();
    });
});

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

describe("offersBankLines", () => {
    it("looks for lines only for an ICICI Bank cheque that is not Old-type", () => {
        expect(offersBankLines({ bank: "ICICI Bank", old_type: 0 })).toBe(true);
        expect(offersBankLines({ bank: "Others", old_type: 0 })).toBe(false);
        expect(offersBankLines({ bank: "ICICI Bank", old_type: 1 })).toBe(false);
    });
});

describe("clearanceDateOf", () => {
    it("is the day the bank line moved the money", () => {
        expect(clearanceDateOf({ name: "OFR-1", amount: 1, added_on: "2026-10-12 00:00:00" })).toBe("2026-10-12");
        expect(clearanceDateOf({ name: "OFR-1", amount: 1 })).toBeNull();
    });
});

describe("bulkClearText", () => {
    it("counts what cleared and names each skipped cheque with its reason", () => {
        expect(
            bulkClearText({
                changed: [{ cheque: "CHQ-1" }, { cheque: "CHQ-2" }],
                skipped: [{ cheque: "CHQ-3", cheque_no: "004521", reason: "already Cleared" }],
            }),
        ).toBe("2 cleared, 1 skipped: 004521 already Cleared");
        expect(bulkClearText({ changed: [{ cheque: "CHQ-1" }], skipped: [] })).toBe("1 cleared");
    });
});

describe("canClearOrCancel", () => {
    it("lets accounts clear and cancel, never procurement", () => {
        expect(canClearOrCancel("Nirmaan Accountant Profile")).toBe(true);
        expect(canClearOrCancel("Nirmaan Accountant Lead Profile")).toBe(true);
        expect(canClearOrCancel("Nirmaan Admin Profile")).toBe(true);
        expect(canClearOrCancel("Nirmaan Procurement Executive Profile")).toBe(false);
        expect(canClearOrCancel("Nirmaan Project Manager Profile")).toBe(false);
    });
});
