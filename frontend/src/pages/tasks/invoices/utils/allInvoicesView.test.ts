import { describe, expect, it } from "vitest";

import {
    allInvoicesPillsFor,
    approvalText,
    isAllInvoicesPill,
    porterResultText,
    type AllExpenseBillRow,
} from "./allInvoicesView";

const BILL: AllExpenseBillRow = {
    name: "EB-2026-00001",
    expense: "NPE-0001",
    expense_doctype: "Non Project Expenses",
    payment_date: "2026-09-10",
    line_amount: 1180,
    read_total: 1250,
    bill_check: "Mismatched",
    bill_check_reason: "The bill's total is ₹1,250.00; the statement line is ₹1,180.00.",
    approval: "Rejected",
    rejection_reason: "Bill of another shop",
    is_latest: 0,
    invoice_no: null,
    invoice_date: null,
    paid_by: "TEST HOLDER",
    project: null,
    project_name: null,
    uploaded_by: "walk-accountant@example.com",
    uploaded_by_name: "Walk Accountant",
    bill_file: "/private/files/bill.pdf",
    creation: "2026-09-11 10:00:00",
};

describe("All Invoices pills", () => {
    it("are PO / WO / Cashbook / Credit Card / Porter for an Accountant", () => {
        expect(allInvoicesPillsFor("Nirmaan Accountant Profile", "a@example.com").map((p) => p.label)).toEqual([
            "PO", "WO", "Cashbook", "Credit Card", "Porter",
        ]);
        expect(allInvoicesPillsFor(null, "Administrator").map((p) => p.key)).toEqual(["po", "wo", "cashbook", "card", "porter"]);
    });

    it("are PO / WO only for a profile that may not see expense or Porter bills", () => {
        expect(allInvoicesPillsFor("Nirmaan Project Manager Profile", "pm@example.com").map((p) => p.label)).toEqual(["PO", "WO"]);
    });

    it("know their own keys", () => {
        expect(isAllInvoicesPill("porter")).toBe(true);
        expect(isAllInvoicesPill("history")).toBe(false);
    });
});

describe("an expense bill's approval", () => {
    it("says why a rejected bill was rejected", () => {
        expect(approvalText(BILL)).toBe("Rejected: Bill of another shop");
    });

    it("is the status alone otherwise", () => {
        expect(approvalText({ ...BILL, approval: "Auto-approved", rejection_reason: null })).toBe("Auto-approved");
    });
});

describe("a Porter invoice's Validate result", () => {
    it("is the result, then its message", () => {
        expect(porterResultText({ validation_status: "Failed", validation_message: "Fare differs." })).toBe("Failed: Fare differs.");
        expect(porterResultText({ validation_status: "Passed", validation_message: null })).toBe("Passed");
    });
});
