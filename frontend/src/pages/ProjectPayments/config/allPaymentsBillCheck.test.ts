// @vitest-environment jsdom
/**
 * Project Payments -> All Payments shows each Expense's bill and Bill check (#1648, spec #1637): an Invoice column that
 * opens the latest bill, and a Bill check column with its result and approval. PO / WO payment rows leave both empty;
 * an Expense with no Expense bill shows "—" for Bill check.
 */
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { buildApprovalColumns, type ApprovalColumnCtx } from "./approvalColumns";
import { TAB_COLUMNS, type ApprovalQueueRow } from "./approvalsTable.config";
import { PP_TABS } from "./ppTabs.constants";

const ctx: ApprovalColumnCtx = { tab: PP_TABS.ALL_PAYMENTS, projectLabels: new Map(), vendorLabels: new Map() };
const columns = buildApprovalColumns(TAB_COLUMNS[PP_TABS.ALL_PAYMENTS], ctx);

const EXPENSE = {
    name: "NPE-TEST-1",
    source: "Non-Project",
    doctype: "Non Project Expenses",
    invoice: "/private/files/bill.pdf",
    has_invoice: true,
    bill_check: "Mismatched",
    bill_approval: "Pending",
} as unknown as ApprovalQueueRow;

const PO_PAYMENT = {
    name: "PAY-TEST-1",
    source: "Vendor Payment",
    doctype: "Project Payments",
    invoice: "",
    has_invoice: false,
    bill_check: null,
    bill_approval: null,
} as unknown as ApprovalQueueRow;

/** The cell `id` renders for `row`: its text and the link it opens, if any. */
const cell = (id: string, row: ApprovalQueueRow) => {
    const column = columns.find((c) => c.id === id);
    if (!column) throw new Error(`All Payments has no ${id} column`);
    const Cell = column.cell as (ctx: { row: { original: ApprovalQueueRow } }) => ReactElement;
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(Cell({ row: { original: row } })));
    const shown = { text: container.textContent, href: container.querySelector("a")?.getAttribute("href") ?? null };
    act(() => root.unmount());
    return shown;
};

describe("All Payments: an Expense's bill and Bill check", () => {
    it("an Expense row's Invoice opens its latest bill", () => {
        expect(cell("invoice", EXPENSE).href).toMatch(/\/private\/files\/bill\.pdf$/);
    });

    it("an Expense row's Bill check shows the result and the approval", () => {
        expect(cell("bill_check", EXPENSE).text).toBe("MismatchedPending");
    });

    it("a PO / WO payment row leaves both empty", () => {
        expect(cell("invoice", PO_PAYMENT)).toEqual({ text: "", href: null });
        expect(cell("bill_check", PO_PAYMENT)).toEqual({ text: "", href: null });
    });

    it("an Expense with no Expense bill shows — for Bill check, and its bill still opens", () => {
        const noBill = { ...EXPENSE, bill_check: null, bill_approval: null } as ApprovalQueueRow;
        expect(cell("bill_check", noBill).text).toBe("—");
        expect(cell("invoice", noBill).href).toMatch(/\/private\/files\/bill\.pdf$/);
    });

    it("no other tab gains the two columns", () => {
        const others = Object.entries(TAB_COLUMNS).filter(([tab]) => tab !== PP_TABS.ALL_PAYMENTS);
        for (const [, ids] of others) {
            expect(ids).not.toContain("invoice");
            expect(ids).not.toContain("bill_check");
        }
    });
});
