import { describe, expect, it } from "vitest";
import { cardInvoiceActions } from "./cardInvoicesView";
import {
    ALL,
    cashbookInvoiceActions,
    cashbookInvoiceFilterOptions,
    cashbookLedgerLabel,
    filterCashbookInvoices,
    type CashbookInvoiceRow,
} from "./cashbookInvoicesView";

/** A wallet spend waiting for its invoice, as `get_cashbook_invoice_queue` returns it. */
const row = (
    name: string,
    paid_by: string | null,
    payment_date: string,
    project: string | null = null,
): CashbookInvoiceRow => ({
    name,
    doctype: project ? "Project Expenses" : "Non Project Expenses",
    payment_date,
    amount: 180,
    expense_type: "Office Supplies",
    paid_by,
    remark: "Transport charges",
    project,
    project_name: project ? `Site ${project}` : null,
    cashbook_batch: "OIB-0001",
});

const ROWS = [
    row("PE-1", "Asha Menon", "2026-10-02", "PRJ-1"),
    row("NPE-1", "Ravi Kumar", "2026-10-01"),
    row("NPE-2", "Asha Menon", "2026-09-30"),
];

const NONE = { paidBy: ALL, ledger: ALL, month: ALL };

describe("which wallet spends show", () => {
    it("shows every waiting spend with no filter", () => {
        expect(filterCashbookInvoices(ROWS, NONE).map((r) => r.name)).toEqual(["PE-1", "NPE-1", "NPE-2"]);
    });

    it("narrows to one wallet holder", () => {
        expect(filterCashbookInvoices(ROWS, { ...NONE, paidBy: "Asha Menon" }).map((r) => r.name)).toEqual(["PE-1", "NPE-2"]);
    });

    it("narrows to Project or Non-Project spends", () => {
        expect(filterCashbookInvoices(ROWS, { ...NONE, ledger: "Project Expenses" }).map((r) => r.name)).toEqual(["PE-1"]);
        expect(filterCashbookInvoices(ROWS, { ...NONE, ledger: "Non Project Expenses" }).map((r) => r.name)).toEqual(["NPE-1", "NPE-2"]);
    });

    it("narrows to the month the money was spent", () => {
        expect(filterCashbookInvoices(ROWS, { ...NONE, month: "2026-09" }).map((r) => r.name)).toEqual(["NPE-2"]);
    });
});

describe("the filter choices", () => {
    it("lists each holder once, by name, and leaves out a spend with no holder", () => {
        const { payers } = cashbookInvoiceFilterOptions([...ROWS, row("NPE-3", null, "2026-10-03")]);
        expect(payers).toEqual(["Asha Menon", "Ravi Kumar"]);
    });

    it("lists each month once, newest first, labelled", () => {
        expect(cashbookInvoiceFilterOptions(ROWS).months).toEqual([
            { value: "2026-10", label: "Oct 2026" },
            { value: "2026-09", label: "Sep 2026" },
        ]);
    });
});

describe("the ledger a spend sits on", () => {
    it("names the project of a Project spend", () => {
        expect(cashbookLedgerLabel(ROWS[0])).toEqual({ kind: "Project", project: "Site PRJ-1" });
    });

    it("says Non-Project otherwise", () => {
        expect(cashbookLedgerLabel(ROWS[1])).toEqual({ kind: "Non-Project", project: null });
    });

    it("falls back to the project id when it has no name", () => {
        expect(cashbookLedgerLabel({ ...ROWS[0], project_name: null })).toEqual({ kind: "Project", project: "PRJ-1" });
    });
});

describe("who gets which action", () => {
    it("is the Credit Card tab's rule", () => {
        for (const role of ["Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile", "Nirmaan Admin Profile",
            "Nirmaan Project Manager Profile"]) {
            expect(cashbookInvoiceActions(role, "someone@example.com")).toEqual(cardInvoiceActions(role, "someone@example.com"));
        }
    });

    it("hides No invoice from an Accountant and offers it to an Accountant Lead", () => {
        expect(cashbookInvoiceActions("Nirmaan Accountant Profile", "a@example.com")).toEqual({ attach: true, noInvoice: false });
        expect(cashbookInvoiceActions("Nirmaan Accountant Lead Profile", "l@example.com")).toEqual({ attach: true, noInvoice: true });
    });
});
