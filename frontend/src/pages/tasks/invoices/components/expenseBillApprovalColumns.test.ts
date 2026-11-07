// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { PendingExpenseBillRow } from "../utils/expenseBillApprovalView";
import { getExpenseBillApprovalColumns } from "./expenseBillApprovalColumns";

const ROW: PendingExpenseBillRow = {
    name: "EB-2026-00001",
    expense: "PE-0001",
    expense_doctype: "Project Expenses",
    payment_date: "2026-09-10",
    line_amount: 1180,
    read_total: null,
    bill_check: "Not read",
    bill_check_reason: "The reader timed out.",
    invoice_no: "TYPED-3",
    invoice_date: "2026-09-04",
    paid_by: "TEST WALLET HOLDER",
    project: "PRJ-1",
    project_name: "Test Lakeview",
    uploaded_by: "walk-accountant@example.com",
    uploaded_by_name: "Walk Accountant",
    bill_file: "/private/files/bill.pdf",
};

const columns = getExpenseBillApprovalColumns({ onApprove: () => undefined, onReject: () => undefined });

const idOf = (c: (typeof columns)[number]) => c.id ?? ("accessorKey" in c ? String(c.accessorKey) : "");

type Meta = { exportHeaderName?: string; exportValue?: (r: PendingExpenseBillRow) => string; excludeFromExport?: boolean };

describe("the Cashbook / Credit Card approval table's columns", () => {
    it("show what an approver decides on, then the actions", () => {
        expect(columns.map(idOf)).toEqual([
            "payment_date", "line_amount", "read_total", "bill_check", "invoice", "paid_by", "project", "uploaded_by",
            "bill_file", "actions",
        ]);
    });

    it("export every column but the actions, a bill with no total read leaving it blank", () => {
        const exported = columns.filter((c) => !(c.meta as Meta)?.excludeFromExport);
        expect(exported.map((c) => String((c.meta as Meta).exportValue?.(ROW)))).toEqual([
            "10-Sep-2026", "1180", "", "Not read: The reader timed out.", "TYPED-3 / 04-Sep-2026", "TEST WALLET HOLDER",
            "Test Lakeview", "Walk Accountant", "/private/files/bill.pdf",
        ]);
    });
});
