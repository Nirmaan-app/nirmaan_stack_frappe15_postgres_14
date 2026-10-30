import { describe, expect, it } from "vitest";
import {
    ALL,
    cardInvoiceActions,
    cardInvoiceFacetOptions,
    cardInvoiceFilterOptions,
    filterCardInvoices,
    NO_EXPENSE_TYPE,
    statementMonthLabel,
    summariseCardSpendsByType,
    statementMonthsLabel,
    type CardInvoiceRow,
} from "./cardInvoicesView";

/** A spend on a statement covering `statement_months` (oldest first), as `get_card_invoice_queue` returns it. */
const row = (name: string, holder: string, ...statement_months: string[]): CardInvoiceRow => ({
    name,
    payment_date: "2026-09-10",
    amount: 100,
    expense_type: "Misc. Expenses",
    details: "Swiggy Limited Bangalore IN",
    merchant: "SWIGGY",
    holder,
    credit_card_statement: `CCS-${holder}-${statement_months.join("-")}`,
    statement_date: `${statement_months[statement_months.length - 1]}-28`,
    period_from: `${statement_months[0]}-01`,
    period_to: `${statement_months[statement_months.length - 1]}-28`,
    statement_months,
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

    it("finds a statement under every month its period overlaps", () => {
        const across = [row("NPE-4", "ARJUN TESTHOLDER", "2026-09", "2026-10")];
        expect(filterCardInvoices(across, { holder: ALL, month: "2026-09" }).map((r) => r.name)).toEqual(["NPE-4"]);
        expect(filterCardInvoices(across, { holder: ALL, month: "2026-10" }).map((r) => r.name)).toEqual(["NPE-4"]);
        expect(filterCardInvoices(across, { holder: ALL, month: "2026-08" })).toEqual([]);
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

    it("offers every month a statement overlaps", () => {
        const { months } = cardInvoiceFilterOptions([row("NPE-4", "ARJUN TESTHOLDER", "2026-09", "2026-10")]);
        expect(months.map((m) => m.value)).toEqual(["2026-10", "2026-09"]);
    });

    it("names a statement's months as a range", () => {
        expect(statementMonthsLabel(["2026-10"])).toBe("Oct 2026");
        expect(statementMonthsLabel(["2026-09", "2026-10"])).toBe("Sep – Oct 2026");
        expect(statementMonthsLabel(["2026-12", "2027-01"])).toBe("Dec 2026 – Jan 2027");
        expect(statementMonthsLabel([])).toBe("");
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

describe("the summary card's split by Expense Type", () => {
    const spend = (amount: number, expense_type: string | null) => ({ amount, expense_type });

    it("totals the spends and groups them by type, largest amount first", () => {
        const summary = summariseCardSpendsByType([
            spend(500, "Travel"), spend(1200, "Software"), spend(300, "Travel"), spend(100, "Fuel"),
        ]);
        expect(summary.count).toBe(4);
        expect(summary.amount).toBe(2100);
        expect(summary.byType).toEqual([
            { expenseType: "Software", amount: 1200, count: 1 },
            { expenseType: "Travel", amount: 800, count: 2 },
            { expenseType: "Fuel", amount: 100, count: 1 },
        ]);
    });

    it("groups spends with no Expense Type under one label instead of dropping them", () => {
        const summary = summariseCardSpendsByType([spend(50, null), spend(70, ""), spend(10, "Fuel")]);
        expect(summary.byType).toEqual([
            { expenseType: NO_EXPENSE_TYPE, amount: 120, count: 2 },
            { expenseType: "Fuel", amount: 10, count: 1 },
        ]);
        expect(summary.byType.reduce((s, t) => s + t.count, 0)).toBe(summary.count);
    });

    it("breaks equal amounts by name so the order never jumps between renders", () => {
        const names = summariseCardSpendsByType([spend(100, "Travel"), spend(100, "Fuel")]).byType.map((t) => t.expenseType);
        expect(names).toEqual(["Fuel", "Travel"]);
    });

    it("is empty when the filters leave no spends", () => {
        expect(summariseCardSpendsByType([])).toEqual({ count: 0, amount: 0, byType: [] });
    });
});

describe("the Expense Type and Holder column filters", () => {
    const spend = (holder: string, expense_type: string | null): CardInvoiceRow => ({
        ...row("NPE-x", holder, "2026-10"), expense_type,
    });

    it("offers each value once, by name, with its count", () => {
        const { expenseTypes, holders } = cardInvoiceFacetOptions([
            spend("MEERA CARDHOLDER", "Travel"), spend("ARJUN TESTHOLDER", "Fuel"), spend("ARJUN TESTHOLDER", "Travel"),
        ]);
        expect(expenseTypes).toEqual([
            { label: "Fuel (1)", value: "Fuel" },
            { label: "Travel (2)", value: "Travel" },
        ]);
        expect(holders).toEqual([
            { label: "ARJUN TESTHOLDER (2)", value: "ARJUN TESTHOLDER" },
            { label: "MEERA CARDHOLDER (1)", value: "MEERA CARDHOLDER" },
        ]);
    });

    it("offers each statement by its months and ID, so two statements over the same months stay apart", () => {
        const { statements } = cardInvoiceFacetOptions([
            row("NPE-1", "ARJUN TESTHOLDER", "2026-09", "2026-10"),
            row("NPE-2", "MEERA CARDHOLDER", "2026-09", "2026-10"),
            row("NPE-3", "ARJUN TESTHOLDER", "2026-09", "2026-10"),
        ]);
        expect(statements).toEqual([
            { label: "Sep – Oct 2026 · CCS-ARJUN TESTHOLDER-2026-09-2026-10 (2)", value: "Sep – Oct 2026 · CCS-ARJUN TESTHOLDER-2026-09-2026-10" },
            { label: "Sep – Oct 2026 · CCS-MEERA CARDHOLDER-2026-09-2026-10 (1)", value: "Sep – Oct 2026 · CCS-MEERA CARDHOLDER-2026-09-2026-10" },
        ]);
    });

    it("offers spends with no Expense Type under the same label the summary card uses", () => {
        const { expenseTypes } = cardInvoiceFacetOptions([spend("A", null), spend("A", "")]);
        expect(expenseTypes).toEqual([{ label: `${NO_EXPENSE_TYPE} (2)`, value: NO_EXPENSE_TYPE }]);
        expect(summariseCardSpendsByType([spend("A", null)]).byType[0].expenseType).toBe(NO_EXPENSE_TYPE);
    });
});
