// @vitest-environment jsdom
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { AllExpenseBillRow, PorterInvoiceListRow } from "../utils/allInvoicesView";
import { getAllExpenseBillColumns, getPorterInvoiceColumns } from "./allInvoicesColumns";

const BILL: AllExpenseBillRow = {
    name: "EB-2026-00001", expense: "NPE-0001", expense_doctype: "Non Project Expenses", payment_date: "2026-09-10",
    line_amount: 1180, read_total: 1250, bill_check: "Mismatched", bill_check_reason: "Totals differ.",
    approval: "Rejected", rejection_reason: "Bill of another shop", is_latest: 0, invoice_no: null, invoice_date: null,
    paid_by: "TEST HOLDER", project: null, project_name: null, uploaded_by: "walk-accountant@example.com",
    uploaded_by_name: "Walk Accountant", bill_file: "/private/files/bill.pdf", creation: "2026-09-11 10:00:00",
};

const PORTER: PorterInvoiceListRow = {
    name: "TESTPRT0001", import_batch: "OFI-TEST", validation_status: "Error",
    validation_message: "The invoice could not be downloaded.", city: "Testpur", completed_orders: 3,
    read_invoice_date: null, fare_total: 1000, tax_total: 180, invoice_total: 1180, invoice_file: null,
    creation: "2026-09-11 10:00:00",
};

type AnyColumn = { id?: string; accessorKey?: string; cell?: unknown; meta?: { exportValue?: (r: never) => string } };
const idOf = (c: AnyColumn) => c.id ?? String(c.accessorKey ?? "");

const render = <T,>(columns: AnyColumn[], id: string, row: T): HTMLElement => {
    const column = columns.find((c) => idOf(c) === id)!;
    const cell = column.cell as (ctx: { row: { original: T } }) => ReactElement | string;
    const el = document.createElement("div");
    act(() => createRoot(el).render(cell({ row: { original: row } }) as ReactElement));
    return el;
};

describe("All Invoices -> Cashbook / Credit Card columns", () => {
    const columns = getAllExpenseBillColumns() as AnyColumn[];

    it("show what the spec lists, each id a field the server sorts or filters by", () => {
        expect(columns.map(idOf)).toEqual([
            "payment_date", "expense", "line_amount", "read_total", "invoice_no", "bill_check", "approval", "is_latest",
            "paid_by", "project_name", "uploaded_by_name", "creation", "bill_file",
        ]);
    });

    it("mark a replaced bill as history and give a rejected bill's reason", () => {
        expect(render(columns, "is_latest", BILL).textContent).toBe("Replaced");
        expect(render(columns, "approval", BILL).textContent).toContain("Bill of another shop");
        expect(render(columns, "bill_file", BILL).querySelector("a")?.getAttribute("href")).toContain("/private/files/bill.pdf");
    });
});

describe("All Invoices -> Porter columns", () => {
    const columns = getPorterInvoiceColumns() as AnyColumn[];

    it("show the Validate result with its message", () => {
        expect(render(columns, "validation_status", PORTER).textContent).toContain("Error");
        expect(render(columns, "validation_status", PORTER).textContent).toContain("could not be downloaded");
    });

    it("open the PDF, and offer nothing to open before it arrived", () => {
        expect(render(columns, "invoice_file", PORTER).querySelector("a")).toBeNull();
        const withPdf = render(columns, "invoice_file", { ...PORTER, invoice_file: "/private/files/p.pdf" });
        expect(withPdf.querySelector("a")?.getAttribute("href")).toContain("/private/files/p.pdf");
    });
});
