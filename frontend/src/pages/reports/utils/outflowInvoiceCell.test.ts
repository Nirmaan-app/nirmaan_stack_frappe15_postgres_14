// The Payments Report (Project)'s Invoice column (#1603): what each row's cell holds.
import { describe, expect, it } from "vitest";

import type { OutflowRowData } from "../hooks/useOutflowReportData";
import { PORTER_INVOICE_PDF_METHOD } from "@/utils/porterExpense";
import { outflowInvoiceCell, outflowInvoiceExportText } from "./outflowInvoiceCell";

const userName = (id?: string) => (id === "lead@example.test" ? "Asha Lead" : id ?? "--");

const expenseRow = (doc: Record<string, unknown>): OutflowRowData => ({
    id: "PE-1",
    payment_date: "2026-10-01",
    project: "PROJ-A",
    vendor: "VEN-1",
    amount: 100,
    expense_type: "Travel",
    details: "Cab",
    effective_gst: 0,
    ref: "--",
    source_doctype: "Project Expenses",
    originalDoc: { name: "PE-1", ...doc } as OutflowRowData["originalDoc"],
});

const paymentRow: OutflowRowData = {
    ...expenseRow({}),
    id: "PP-1",
    source_doctype: "Project Payments",
    originalDoc: { name: "PP-1", invoice_attachment: "/files/should-not-show.pdf" } as unknown as OutflowRowData["originalDoc"],
};

const marked = {
    no_invoice_reason: "Toll booth gives no bill",
    no_invoice_by: "lead@example.test",
    no_invoice_at: "2026-10-05 11:20:00",
};

describe("outflowInvoiceCell", () => {
    it("links a Project Expense's invoice file", () => {
        const cell = outflowInvoiceCell(expenseRow({ invoice_attachment: "/private/files/bill-1.pdf" }), userName);
        expect(cell).toEqual({ kind: "invoice", url: "/private/files/bill-1.pdf" });
    });

    it("opens a Porter expense's invoice through the expense, as elsewhere in the app", () => {
        const cell = outflowInvoiceCell(
            expenseRow({ invoice_attachment: "/private/files/porter-inv.pdf", porter_order: "CRN-9" }),
            userName,
        );
        expect(cell).toEqual({
            kind: "invoice",
            url: `/api/method/${PORTER_INVOICE_PDF_METHOD}?doctype=Project+Expenses&name=PE-1`,
        });
    });

    it("shows No invoice with who, when and why for a marked expense", () => {
        const cell = outflowInvoiceCell(expenseRow(marked), userName);
        expect(cell).toEqual({ kind: "no_invoice", label: "No invoice", detail: "Asha Lead, 05-Oct-2026: Toll booth gives no bill" });
    });

    it("prefers the invoice file over a No-invoice mark", () => {
        const cell = outflowInvoiceCell(expenseRow({ ...marked, invoice_attachment: "/files/b.pdf" }), userName);
        expect(cell.kind).toBe("invoice");
    });

    it("shows a dash for an expense with neither", () => {
        expect(outflowInvoiceCell(expenseRow({}), userName)).toEqual({ kind: "none" });
    });

    it("leaves a Project Payment (vendor payment) blank", () => {
        expect(outflowInvoiceCell(paymentRow, userName)).toEqual({ kind: "blank" });
    });
});

describe("outflowInvoiceExportText", () => {
    it("exports the invoice's full link, the No-invoice note, a dash, or nothing", () => {
        expect(outflowInvoiceExportText(expenseRow({ invoice_attachment: "/files/b.pdf" }), userName, "https://erp.example")).toBe(
            "https://erp.example/files/b.pdf",
        );
        expect(outflowInvoiceExportText(expenseRow(marked), userName, "")).toBe(
            "No invoice (Asha Lead, 05-Oct-2026: Toll booth gives no bill)",
        );
        expect(outflowInvoiceExportText(expenseRow({}), userName, "")).toBe("--");
        expect(outflowInvoiceExportText(paymentRow, userName, "")).toBe("");
    });
});
