// @vitest-environment jsdom
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const noop = () => undefined;
const columns = getExpenseBillApprovalColumns({ onApprove: noop, onReject: noop, onReadAgain: noop, canReadAgain: true });

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

/** The labels of the buttons the actions cell renders for `row`. */
const actionsFor = (row: PendingExpenseBillRow, canReadAgain: boolean) => {
    const cols = getExpenseBillApprovalColumns({ onApprove: noop, onReject: noop, onReadAgain: noop, canReadAgain });
    const actions = cols.find((c) => idOf(c) === "actions")!;
    const Cell = actions.cell as (ctx: { row: { original: PendingExpenseBillRow } }) => ReactElement;
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(Cell({ row: { original: row } })));
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    act(() => root.unmount());
    return labels;
};

describe("Read again (#1645)", () => {
    it("shows on a Not read bill to someone who may read it again", () => {
        expect(actionsFor(ROW, true)).toEqual(["Read again", "Approve", "Reject"]);
    });

    it("is absent for anyone else", () => {
        expect(actionsFor(ROW, false)).toEqual(["Approve", "Reject"]);
    });

    it("is absent on a bill that was read", () => {
        expect(actionsFor({ ...ROW, bill_check: "Mismatched", read_total: 1250 }, true)).toEqual(["Approve", "Reject"]);
    });
});
