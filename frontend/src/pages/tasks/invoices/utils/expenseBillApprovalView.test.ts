import { describe, expect, it } from "vitest";

import { NOT_SET_FACET_VALUE } from "@/components/data-table/facetConfig";

import {
    type PendingExpenseBillRow,
    BILL_APPROVAL_FILTER_OPTIONS,
    BILL_CHECK_FILTER_OPTIONS,
    approveBillSchema,
    approveFormDefaults,
    expenseListBillCheck,
    expenseListBillCheckText,
    billCheckText,
    lastBillRejectedText,
    readTotalText,
    rejectBillSchema,
} from "./expenseBillApprovalView";

const ROW: PendingExpenseBillRow = {
    name: "EB-2026-00001",
    expense: "NPE-0001",
    expense_doctype: "Non Project Expenses",
    payment_date: "2026-09-10",
    line_amount: 1180,
    read_total: 1250,
    bill_check: "Mismatched",
    bill_check_reason: "The bill's total is ₹1,250.00; the statement line is ₹1,180.00.",
    invoice_no: "TYPED-3",
    invoice_date: "2026-09-04",
    paid_by: "TEST HOLDER",
    project: null,
    project_name: null,
    uploaded_by: "walk-accountant@example.com",
    uploaded_by_name: "Walk Accountant",
    bill_file: "/private/files/bill.pdf",
};

describe("a waiting expense bill's cells", () => {
    it("show the Bill check with its reason", () => {
        expect(billCheckText(ROW)).toBe("Mismatched: The bill's total is ₹1,250.00; the statement line is ₹1,180.00.");
        expect(billCheckText({ ...ROW, bill_check: "Not checked", bill_check_reason: null })).toBe("Not checked");
    });

    it("show a dash for the total read when none was compared", () => {
        expect(readTotalText({ ...ROW, read_total: null })).toBe("--");
        expect(readTotalText(ROW)).toBe("₹1,250");
    });
});

describe("the approve form", () => {
    it("starts from the number and date the row offers", () => {
        expect(approveFormDefaults(ROW)).toEqual({ invoice_no: "TYPED-3", invoice_date: "2026-09-04" });
    });

    it("starts blank when the row offers none", () => {
        expect(approveFormDefaults({ ...ROW, invoice_no: null, invoice_date: null })).toEqual({ invoice_no: "", invoice_date: "" });
    });
});

describe("the approve form's checks", () => {
    const schema = approveBillSchema("2026-09-15");
    const errorsOf = (values: { invoice_no: string; invoice_date: string }) => {
        const parsed = schema.safeParse(values);
        return parsed.success ? {} : parsed.error.flatten().fieldErrors;
    };

    it("takes a number and a date up to today, the number trimmed", () => {
        expect(schema.parse({ invoice_no: "  INV-9 ", invoice_date: "2026-09-15" })).toEqual({ invoice_no: "INV-9", invoice_date: "2026-09-15" });
    });

    it("takes neither: both are optional", () => {
        expect(schema.parse({ invoice_no: "", invoice_date: "" })).toEqual({ invoice_no: "", invoice_date: "" });
    });

    it("refuses a date after today, or one that is not a date", () => {
        expect(errorsOf({ invoice_no: "", invoice_date: "2026-09-16" }).invoice_date).toEqual(["The invoice date cannot be after today."]);
        expect(errorsOf({ invoice_no: "", invoice_date: "15/09/2026" }).invoice_date).toEqual(["Give the date as a calendar date."]);
    });
});

describe("the reject form's check", () => {
    it("needs a reason, and trims it", () => {
        expect(rejectBillSchema.safeParse({ reason: "   " }).success).toBe(false);
        expect(rejectBillSchema.parse({ reason: " Bill of another shop " })).toEqual({ reason: "Bill of another shop" });
    });
});

describe("a spend back in Pending Invoices Upload", () => {
    it("says why its last bill was rejected", () => {
        expect(lastBillRejectedText("Bill of another shop")).toBe("Last bill rejected: Bill of another shop");
    });

    it("says nothing when no bill was rejected", () => {
        expect(lastBillRejectedText(null)).toBeNull();
        expect(lastBillRejectedText(undefined)).toBeNull();
    });
});

describe("the Bill check column of the expense lists", () => {
    it.each([
        ["Checking", "Pending"],
        ["Matched", "Auto-approved"],
        ["Matched", "Approved"],
        ["Mismatched", "Pending"],
        ["Mismatched", "Rejected"],
        ["Not read", "Approved"],
        ["Not checked", "Pending"],
    ] as const)("shows a %s bill that is %s", (result, approval) => {
        const row = { bill_check: result, bill_approval: approval };

        expect(expenseListBillCheck(row)).toEqual({ result, approval });
        expect(expenseListBillCheckText(row)).toBe(`${result} · ${approval}`);
    });

    it("shows a dash for an Expense with no Expense bill", () => {
        expect(expenseListBillCheck({ bill_check: null, bill_approval: null })).toBeNull();
        expect(expenseListBillCheck({})).toBeNull();
        expect(expenseListBillCheckText({})).toBe("—");
    });

    it("filters on each result, each approval status, and no bill", () => {
        expect(BILL_CHECK_FILTER_OPTIONS.map((o) => o.label)).toEqual([
            "Checking", "Matched", "Mismatched", "Not read", "Not checked", "— (no bill)",
        ]);
        expect(BILL_APPROVAL_FILTER_OPTIONS.map((o) => o.label)).toEqual([
            "Auto-approved", "Pending", "Approved", "Rejected", "— (no bill)",
        ]);
        expect(BILL_CHECK_FILTER_OPTIONS.at(-1)?.value).toBe(NOT_SET_FACET_VALUE);
        expect(BILL_APPROVAL_FILTER_OPTIONS.at(-1)?.value).toBe(NOT_SET_FACET_VALUE);
    });
});
