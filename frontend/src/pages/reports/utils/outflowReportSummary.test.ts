import { describe, expect, it } from "vitest";

import { getOutflowReportColumns } from "../components/columns/outflowColumns";
import type { PartiallyReconciledItem } from "../hooks/usePartiallyReconciled";
import { projectOutflowNote, reconciledInReportFilters, singleProjectFilter } from "./outflowReportSummary";

const columns = getOutflowReportColumns((id) => id ?? "--", (id) => id ?? "Others");

const item = (over: Partial<PartiallyReconciledItem>): PartiallyReconciledItem => ({
    doctype: "Project Payments",
    name: "PP-1",
    amount: 0,
    document_type: "Procurement Orders",
    document_name: "PO-1",
    bill_amount: 0,
    pending_amount: 0,
    latest_line_date: "2026-10-01",
    line_count: 1,
    project: "PROJ-A",
    project_name: "Project A",
    type: null,
    description: null,
    vendor: "VEN-1",
    expense_type_name: null,
    ...over,
});

// Three part-reconciled records: a PO payment on A to VEN-1 (1,000), a WO payment on B to VEN-2
// (400), and a Travel expense on A to VEN-2 (50).
const items = [
    item({ name: "PP-1", amount: 1000 }),
    item({ name: "PP-2", amount: 400, project: "PROJ-B", vendor: "VEN-2", document_type: "Service Requests", document_name: "SR-9" }),
    item({
        doctype: "Project Expenses", name: "PE-1", amount: 50, vendor: "VEN-2", document_type: null, document_name: null,
        type: "ET-7", expense_type_name: "Travel", description: "Site visit cab",
    }),
];

describe("the Outflow Report's part-reconciled add-on follows the report's filters", () => {
    it("with no filter, keeps every record", () => {
        const figure = reconciledInReportFilters(items, columns, [], "");
        expect(figure.amount).toBe(1450);
        expect(figure.count).toBe(3);
    });

    it("with one project selected, keeps only that project's records", () => {
        const figure = reconciledInReportFilters(items, columns, [{ id: "project", value: ["PROJ-A"] }], "");
        expect(figure.amount).toBe(1050);
        expect(figure.items.map((i) => i.name)).toEqual(["PP-1", "PE-1"]);
    });

    it("applies the vendor and expense type filters too", () => {
        expect(reconciledInReportFilters(items, columns, [{ id: "vendor", value: ["VEN-2"] }], "").amount).toBe(450);
        expect(
            reconciledInReportFilters(items, columns, [{ id: "expense_type", value: ["Payment Against SR"] }], "").amount,
        ).toBe(400);
        expect(reconciledInReportFilters(items, columns, [{ id: "expense_type", value: ["Travel"] }], "").amount).toBe(50);
    });

    it("applies the search box", () => {
        expect(reconciledInReportFilters(items, columns, [], "SR-9").items.map((i) => i.name)).toEqual(["PP-2"]);
    });
});

describe("the single-project note is shown only when one project is the whole filter", () => {
    it("names the project when it is the only filter", () => {
        expect(singleProjectFilter([{ id: "project", value: ["PROJ-A"] }], "")).toBe("PROJ-A");
    });

    it("shows nothing for no project, two projects, another filter, or a search", () => {
        expect(singleProjectFilter([], "")).toBeNull();
        expect(singleProjectFilter([{ id: "project", value: ["PROJ-A", "PROJ-B"] }], "")).toBeNull();
        expect(singleProjectFilter([{ id: "project", value: ["PROJ-A"] }, { id: "vendor", value: ["VEN-1"] }], "")).toBeNull();
        expect(singleProjectFilter([{ id: "project", value: ["PROJ-A"] }], "PO-1")).toBeNull();
    });
});

describe("the note's figures add up to Project outflow", () => {
    // The decision record's worked example: PO 5,00,000 + WO 2,94,000 + expenses 50,000 in the list;
    // a 20,000 refund and 7,000 of TDS outside it; Project outflow 8,31,000.
    it("reads list, refunds, TDS and Project outflow", () => {
        expect(projectOutflowNote(844000, { refunds: 20000, tds: 7000, outflow: 831000 })).toBe(
            "This list: ₹8,44,000 · Not in this list: refunds −₹20,000, TDS +₹7,000 · Project outflow: ₹8,31,000",
        );
    });
});
