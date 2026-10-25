import { describe, expect, it } from "vitest";
import {
    ALL,
    cardInvoiceActions,
    cardInvoiceFilterOptions,
    filterCardInvoices,
    statementMonthLabel,
    type CardInvoiceRow,
} from "./cardInvoicesView";

const row = (name: string, holder: string, statement_month: string): CardInvoiceRow => ({
    name,
    payment_date: "2026-09-10",
    amount: 100,
    expense_type: "Misc. Expenses",
    details: "Swiggy Limited Bangalore IN",
    merchant: "SWIGGY",
    holder,
    credit_card_statement: `CCS-${holder}-${statement_month}`,
    statement_date: `${statement_month}-01`,
    period_from: "2026-09-02",
    period_to: `${statement_month}-01`,
    statement_month,
});

const ROWS = [
    row("NPE-1", "ARJUN TESTHOLDER", "2026-10"),
    row("NPE-2", "MEERA CARDHOLDER", "2026-10"),
    row("NPE-3", "ARJUN TESTHOLDER", "2026-09"),
];

describe("which card spends show", () => {
    it("shows every waiting spend with no filter", () => {
        expect(filterCardInvoices(ROWS, { holder: ALL, month: ALL }).map((r) => r.name)).toEqual(["NPE-1", "NPE-2", "NPE-3"]);
    });

    it("narrows to one holder", () => {
        expect(filterCardInvoices(ROWS, { holder: "ARJUN TESTHOLDER", month: ALL }).map((r) => r.name)).toEqual(["NPE-1", "NPE-3"]);
    });

    it("narrows to one statement month", () => {
        expect(filterCardInvoices(ROWS, { holder: ALL, month: "2026-10" }).map((r) => r.name)).toEqual(["NPE-1", "NPE-2"]);
    });

    it("narrows by both at once", () => {
        expect(filterCardInvoices(ROWS, { holder: "ARJUN TESTHOLDER", month: "2026-09" }).map((r) => r.name)).toEqual(["NPE-3"]);
    });
});

describe("the filter choices", () => {
    it("lists each holder once, in name order, and each month once, newest first", () => {
        const { holders, months } = cardInvoiceFilterOptions(ROWS);
        expect(holders).toEqual(["ARJUN TESTHOLDER", "MEERA CARDHOLDER"]);
        expect(months).toEqual([
            { value: "2026-10", label: "Oct 2026" },
            { value: "2026-09", label: "Sep 2026" },
        ]);
    });

    it("names a month the way the screen shows it", () => {
        expect(statementMonthLabel("2026-01")).toBe("Jan 2026");
        expect(statementMonthLabel("")).toBe("");
    });
});

describe("which actions a user gets", () => {
    it("gives an Accountant Lead and an Admin both Attach and No invoice", () => {
        expect(cardInvoiceActions("Nirmaan Accountant Lead Profile", "lead@x.com")).toEqual({ attach: true, noInvoice: true });
        expect(cardInvoiceActions("Nirmaan Admin Profile", "admin@x.com")).toEqual({ attach: true, noInvoice: true });
        expect(cardInvoiceActions("", "Administrator")).toEqual({ attach: true, noInvoice: true });
    });

    it("gives an Accountant, PMO and procurement Attach only", () => {
        for (const role of [
            "Nirmaan Accountant Profile",
            "Nirmaan PMO Executive Profile",
            "Nirmaan Procurement Executive Profile",
        ]) {
            expect(cardInvoiceActions(role, "u@x.com")).toEqual({ attach: true, noInvoice: false });
        }
    });

    it("gives anyone else nothing", () => {
        expect(cardInvoiceActions("Nirmaan Project Manager Profile", "pm@x.com")).toEqual({ attach: false, noInvoice: false });
    });
});
