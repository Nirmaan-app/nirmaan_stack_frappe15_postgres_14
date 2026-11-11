import { describe, expect, it } from "vitest";

import type { CashbookInvoiceRow } from "../utils/cashbookInvoicesView";
import { getCashbookInvoiceColumns } from "./cashbookInvoiceColumns";

const ROW: CashbookInvoiceRow = {
    name: "PE-1",
    doctype: "Project Expenses",
    payment_date: "2026-10-02",
    amount: 1250.5,
    expense_type: "Site Travel",
    paid_by: "Asha Menon",
    remark: "Auto fare to site",
    project: "PRJ-1",
    project_name: "Lakeview Towers",
    cashbook_batch: "OIB-0001",
};

const columns = getCashbookInvoiceColumns({
    actions: { attach: true, noInvoice: true },
    onAttach: () => undefined,
    onNoInvoice: () => undefined,
});

const idOf = (c: (typeof columns)[number]) =>
    c.id ?? ("accessorKey" in c ? String(c.accessorKey) : "");

type Meta = { exportHeaderName?: string; exportValue?: (r: CashbookInvoiceRow) => string; excludeFromExport?: boolean };

describe("the Cashbook table's columns", () => {
    it("are Date, Amount, Paid by, Remark, Project, Expense Type, then the actions", () => {
        expect(columns.map(idOf)).toEqual(["payment_date", "amount", "paid_by", "remark", "project", "expense_type", "actions"]);
    });

    it("give Project, Expense Type and Paid by a column filter", () => {
        for (const id of ["project", "expense_type", "paid_by"]) {
            expect(columns.find((c) => idOf(c) === id)?.filterFn, id).toBeTypeOf("function");
        }
    });

    it("export every column but the actions, with its heading", () => {
        const exported = columns.filter((c) => !(c.meta as Meta)?.excludeFromExport);
        expect(exported.map((c) => (c.meta as Meta).exportHeaderName))
            .toEqual(["Date", "Amount", "Paid by", "Remark", "Project", "Expense Type"]);
        expect(exported.map((c) => String((c.meta as Meta).exportValue?.(ROW))))
            .toEqual(["02-Oct-2026", "1251", "Asha Menon", "Auto fare to site", "Lakeview Towers", "Site Travel"]);
    });

    it("export a blank Project for a Non-Project spend", () => {
        const project = columns.find((c) => idOf(c) === "project");
        expect((project?.meta as Meta).exportValue?.({ ...ROW, doctype: "Non Project Expenses", project: null, project_name: null }))
            .toBe("");
    });

    it("leave the amount and the date out of the search box", () => {
        for (const id of ["payment_date", "amount", "actions"]) {
            expect(columns.find((c) => idOf(c) === id)?.enableGlobalFilter, id).toBe(false);
        }
    });
});
