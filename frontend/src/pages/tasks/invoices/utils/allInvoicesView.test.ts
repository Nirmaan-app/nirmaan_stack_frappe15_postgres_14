import { describe, expect, it } from "vitest";

import {
    approvalText,
    billDecision,
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
    approved_by: null,
    approved_on: null,
    rejected_by: "test-approver@example.com",
    rejected_on: "2026-09-12 16:30:00",
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

describe("an expense bill's approval", () => {
    it("says why a rejected bill was rejected", () => {
        expect(approvalText(BILL)).toBe("Rejected: Bill of another shop");
    });

    it("is the status alone otherwise", () => {
        expect(approvalText({ ...BILL, approval: "Auto-approved", rejection_reason: null })).toBe("Auto-approved");
    });
});

describe("who decided an expense bill, and when", () => {
    const APPROVED = {
        ...BILL, approval: "Approved", rejection_reason: null, rejected_by: null, rejected_on: null,
        approved_by: "test-approver@example.com", approved_on: "2026-09-13 09:15:00",
    } as const;

    it("is the approver on an Approved bill", () => {
        expect(billDecision(APPROVED)).toEqual({ by: "test-approver@example.com", on: "2026-09-13 09:15:00" });
    });

    it("is the System on an Auto-approved bill", () => {
        expect(billDecision({ ...APPROVED, approval: "Auto-approved", approved_by: "System" })?.by).toBe("System");
    });

    it("is whoever rejected a Rejected bill", () => {
        expect(billDecision(BILL)).toEqual({ by: "test-approver@example.com", on: "2026-09-12 16:30:00" });
    });

    it("is nobody on a Pending bill, or a decision the bill does not record", () => {
        expect(billDecision({ ...APPROVED, approval: "Pending" })).toBeNull();
        expect(billDecision({ ...BILL, rejected_by: null, rejected_on: null })).toBeNull();
    });
});

describe("a Porter invoice's Validate result", () => {
    it("is the result, then its message", () => {
        expect(porterResultText({ validation_status: "Failed", validation_message: "Fare differs." })).toBe("Failed: Fare differs.");
        expect(porterResultText({ validation_status: "Passed", validation_message: null })).toBe("Passed");
    });
});
