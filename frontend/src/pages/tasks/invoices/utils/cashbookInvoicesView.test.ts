import { describe, expect, it } from "vitest";
import { cardInvoiceActions } from "./cardInvoicesView";
import {
    ALL,
    cashbookInvoiceActions,
    cashbookCountText,
    cashbookExpenseTypeLabel,
    cashbookInvoiceFacetOptions,
    cashbookInvoiceFilterOptions,
    cashbookProjectLabel,
    filterCashbookInvoices,
    type CashbookInvoiceRow,
} from "./cashbookInvoicesView";

/** A wallet spend waiting for its invoice, as `get_cashbook_invoice_queue` returns it. */
const row = (
    name: string,
    paid_by: string | null,
    payment_date: string,
    project: string | null = null,
    expense_type: string | null = "Office Supplies",
): CashbookInvoiceRow => ({
    name,
    doctype: project ? "Project Expenses" : "Non Project Expenses",
    payment_date,
    amount: 180,
    expense_type,
    paid_by,
    remark: "Transport charges",
    project,
    project_name: project ? `Site ${project}` : null,
    cashbook_batch: "OIB-0001",
});

const ROWS = [
    row("PE-1", "Asha Menon", "2026-10-02", "PRJ-1", "Site Travel"),
    row("NPE-1", "Ravi Kumar", "2026-10-01"),
    row("NPE-2", "Asha Menon", "2026-09-30"),
];

const NONE = { ledger: ALL, month: ALL };

describe("which wallet spends show", () => {
    it("shows every waiting spend with no filter", () => {
        expect(filterCashbookInvoices(ROWS, NONE).map((r) => r.name)).toEqual(["PE-1", "NPE-1", "NPE-2"]);
    });

    it("narrows to Project or Non-Project spends", () => {
        expect(filterCashbookInvoices(ROWS, { ...NONE, ledger: "Project Expenses" }).map((r) => r.name)).toEqual(["PE-1"]);
        expect(filterCashbookInvoices(ROWS, { ...NONE, ledger: "Non Project Expenses" }).map((r) => r.name)).toEqual(["NPE-1", "NPE-2"]);
    });

    it("narrows to the month the money was spent", () => {
        expect(filterCashbookInvoices(ROWS, { ...NONE, month: "2026-09" }).map((r) => r.name)).toEqual(["NPE-2"]);
    });

    it("applies the ledger and the month together", () => {
        expect(filterCashbookInvoices(ROWS, { ledger: "Non Project Expenses", month: "2026-10" }).map((r) => r.name))
            .toEqual(["NPE-1"]);
    });
});

describe("the month choices", () => {
    it("lists each month once, newest first, labelled", () => {
        expect(cashbookInvoiceFilterOptions(ROWS).months).toEqual([
            { value: "2026-10", label: "Oct 2026" },
            { value: "2026-09", label: "Sep 2026" },
        ]);
    });
});

describe("the Project column", () => {
    it("names the project of a Project spend", () => {
        expect(cashbookProjectLabel(ROWS[0])).toBe("Site PRJ-1");
    });

    it("falls back to the project id when it has no name", () => {
        expect(cashbookProjectLabel({ ...ROWS[0], project_name: null })).toBe("PRJ-1");
    });

    it("is blank for a Non-Project spend", () => {
        expect(cashbookProjectLabel(ROWS[1])).toBe("");
    });
});

describe("the Expense Type column", () => {
    it("shows the type of a Project and of a Non-Project spend", () => {
        expect(cashbookExpenseTypeLabel(ROWS[0])).toBe("Site Travel");
        expect(cashbookExpenseTypeLabel(ROWS[1])).toBe("Office Supplies");
    });

    it("names a spend with no type the way the Credit Card tab does", () => {
        expect(cashbookExpenseTypeLabel(row("NPE-9", null, "2026-10-01", null, null))).toBe("No expense type");
    });
});

describe("the column-filter choices", () => {
    const rows = [...ROWS, row("PE-2", "Ravi Kumar", "2026-10-04", "PRJ-1"), row("NPE-3", null, "2026-10-03")];

    it("offers each project once with its count, and no blank choice for Non-Project spends", () => {
        expect(cashbookInvoiceFacetOptions(rows).projects).toEqual([{ label: "Site PRJ-1 (2)", value: "Site PRJ-1" }]);
    });

    it("offers every Expense Type across both ledgers, with its count", () => {
        expect(cashbookInvoiceFacetOptions(rows).expenseTypes).toEqual([
            { label: "Office Supplies (4)", value: "Office Supplies" },
            { label: "Site Travel (1)", value: "Site Travel" },
        ]);
    });

    it("offers each wallet holder once with its count, and leaves out a spend with no holder", () => {
        expect(cashbookInvoiceFacetOptions(rows).payers).toEqual([
            { label: "Asha Menon (2)", value: "Asha Menon" },
            { label: "Ravi Kumar (2)", value: "Ravi Kumar" },
        ]);
    });

    it("counts only the rows it is given, so the ledger and month pick narrow the counts", () => {
        const october = filterCashbookInvoices(rows, { ledger: "Non Project Expenses", month: "2026-10" });
        expect(cashbookInvoiceFacetOptions(october).expenseTypes).toEqual([
            { label: "Office Supplies (2)", value: "Office Supplies" },
        ]);
        expect(cashbookInvoiceFacetOptions(october).projects).toEqual([]);
    });
});

describe("the count line", () => {
    it("counts the rows shown, singular and plural", () => {
        expect(cashbookCountText(1)).toBe("1 wallet spend waiting for an invoice");
        expect(cashbookCountText(3)).toBe("3 wallet spends waiting for an invoice");
        expect(cashbookCountText(0)).toBe("0 wallet spends waiting for an invoice");
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
