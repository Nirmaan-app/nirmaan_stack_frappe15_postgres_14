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
    approval: "Rejected", rejection_reason: "Bill of another shop", approved_by: null, approved_on: null,
    rejected_by: "test-approver@example.com", rejected_on: "2026-09-12 16:30:00", is_latest: 0, invoice_no: null, invoice_date: null,
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

const NAMES: Record<string, string> = { "test-approver@example.com": "Test Approver" };
const userName = (id: string) => NAMES[id] ?? id;

describe("All Invoices -> Cashbook / Credit Card columns", () => {
    const columns = getAllExpenseBillColumns({ userName }) as AnyColumn[];

    it("show what the spec lists, each id a field the server sorts or filters by", () => {
        expect(columns.map(idOf)).toEqual([
            "payment_date", "expense", "line_amount", "read_total", "invoice_no", "bill_check", "approval", "decided", "is_latest",
            "paid_by", "project_name", "uploaded_by_name", "creation", "bill_file",
        ]);
    });

    it("mark a replaced bill as history and give a rejected bill's reason", () => {
        expect(render(columns, "is_latest", BILL).textContent).toBe("Replaced");
        expect(render(columns, "approval", BILL).textContent).toContain("Bill of another shop");
        expect(render(columns, "bill_file", BILL).querySelector("a")?.getAttribute("href")).toContain("/private/files/bill.pdf");
    });

    it("say who decided a bill and on which day, by name", () => {
        expect(render(columns, "decided", BILL).textContent).toBe("Test Approver12-Sep-2026");
        const approved = { ...BILL, approval: "Auto-approved", approved_by: "System", approved_on: "2026-09-13 09:15:00" } as const;
        expect(render(columns, "decided", approved).textContent).toBe("System13-Sep-2026");
        const decided = columns.find((c) => idOf(c) === "decided")!;
        expect(decided.meta?.exportValue?.(BILL as never)).toBe("Test Approver, 12-Sep-2026");
    });

    it("leave a Pending bill's decision blank", () => {
        const pending = { ...BILL, approval: "Pending", rejected_by: null, rejected_on: null } as const;
        expect(render(columns, "decided", pending).textContent).toBe("");
    });
});

describe("Read again on All Invoices -> Cashbook / Credit Card", () => {
    const NOT_READ = {
        ...BILL, bill_check: "Not read", bill_check_reason: "The reading stopped.", read_total: null, is_latest: 1,
        approval: "Approved", rejection_reason: null, rejected_by: null, rejected_on: null,
        approved_by: "test-approver@example.com", approved_on: "2026-09-13 09:15:00",
    } as const;

    const actionsFor = (row: AllExpenseBillRow) => {
        const read: string[] = [];
        const columns = getAllExpenseBillColumns({
            userName, readAgain: { onReadAgain: (bill) => read.push(bill.name), readingAgainBill: null },
        }) as AnyColumn[];
        const buttons = [...render(columns, "actions", row).querySelectorAll("button")];
        return { labels: buttons.map((b) => b.textContent), click: () => act(() => buttons[0].click()), read };
    };

    it("shows on the latest bill that was not read, approved by a person or pending, and reads that bill", () => {
        const approved = actionsFor(NOT_READ);
        expect(approved.labels).toEqual(["Read again"]);
        approved.click();
        expect(approved.read).toEqual(["EB-2026-00001"]);
        expect(actionsFor({ ...NOT_READ, approval: "Pending", approved_by: null, approved_on: null }).labels).toEqual(["Read again"]);
    });

    it("is absent on a rejected bill, a replaced bill, or a bill that was read", () => {
        expect(actionsFor({ ...NOT_READ, approval: "Rejected", rejected_by: "x@example.com", rejected_on: "2026-09-14" }).labels).toEqual([]);
        expect(actionsFor({ ...NOT_READ, is_latest: 0 }).labels).toEqual([]);
        expect(actionsFor({ ...NOT_READ, bill_check: "Mismatched", read_total: 1250 }).labels).toEqual([]);
    });

    it("has no column for someone who may not read a bill again", () => {
        expect((getAllExpenseBillColumns({ userName }) as AnyColumn[]).map(idOf)).not.toContain("actions");
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
