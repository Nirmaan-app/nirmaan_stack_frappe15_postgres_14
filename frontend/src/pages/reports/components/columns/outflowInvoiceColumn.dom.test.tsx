// @vitest-environment jsdom
//
// The Payments Report (Project)'s Invoice column renders its four cases (#1603).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CellContext } from "@tanstack/react-table";

import type { OutflowRowData } from "../../hooks/useOutflowReportData";
import { getOutflowReportColumns } from "./outflowColumns";

const userName = (id?: string) => (id === "lead@example.test" ? "Asha Lead" : id ?? "--");
const columns = getOutflowReportColumns((id) => id ?? "--", (id) => id ?? "Others", userName);
const invoiceColumn = columns.find((c) => c.id === "invoice")!;

const row = (source: OutflowRowData["source_doctype"], doc: Record<string, unknown>): OutflowRowData => ({
    id: "PE-7",
    payment_date: "2026-10-01",
    project: "PROJ-A",
    vendor: "VEN-1",
    amount: 100,
    expense_type: "Travel",
    details: "Cab",
    effective_gst: 0,
    ref: "--",
    source_doctype: source,
    originalDoc: { name: "PE-7", ...doc } as OutflowRowData["originalDoc"],
});

describe("Payments Report (Project) Invoice column", () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    const renderCell = (data: OutflowRowData) => {
        const Cell = invoiceColumn.cell as (ctx: CellContext<OutflowRowData, unknown>) => JSX.Element;
        act(() => root.render(Cell({ row: { original: data } } as CellContext<OutflowRowData, unknown>)));
    };

    it("is in the column list, with an export header", () => {
        expect(invoiceColumn).toBeDefined();
        expect((invoiceColumn.meta as { exportHeaderName?: string }).exportHeaderName).toBe("Invoice");
    });

    it("links View invoice to the file, in a new tab", () => {
        renderCell(row("Project Expenses", { invoice_attachment: "/private/files/bill-1.pdf" }));
        const link = host.querySelector("a")!;
        expect(link.textContent).toBe("View invoice");
        expect(link.getAttribute("href")).toMatch(/\/private\/files\/bill-1\.pdf$/);
        expect(link.getAttribute("target")).toBe("_blank");
    });

    it("shows No invoice with the reason, who and when on hover", () => {
        renderCell(
            row("Project Expenses", {
                no_invoice_reason: "Toll booth gives no bill",
                no_invoice_by: "lead@example.test",
                no_invoice_at: "2026-10-05 11:20:00",
            }),
        );
        expect(host.textContent).toBe("No invoice");
        expect(host.querySelector("[title]")!.getAttribute("title")).toBe("Asha Lead, 05-Oct-2026: Toll booth gives no bill");
    });

    it("shows a dash for an expense with neither", () => {
        renderCell(row("Project Expenses", {}));
        expect(host.textContent).toBe("—");
        expect(host.querySelector("a")).toBeNull();
    });

    it("leaves a Project Payment row blank", () => {
        renderCell(row("Project Payments", { invoice_attachment: "/files/x.pdf" }));
        expect(host.textContent).toBe("");
    });
});
