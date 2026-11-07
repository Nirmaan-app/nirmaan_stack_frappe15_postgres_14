// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PendingExpenseBillRow } from "../utils/expenseBillApprovalView";
import { ApproveBillDialog, RejectBillDialog } from "./ExpenseBillDecisionDialogs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW: PendingExpenseBillRow = {
    name: "EB-2026-00001", expense: "PE-0001", expense_doctype: "Project Expenses", payment_date: "2026-09-10",
    line_amount: 1180, read_total: null, bill_check: "Not read", bill_check_reason: "The reader timed out.",
    invoice_no: "TYPED-3", invoice_date: "2026-09-04", paid_by: "TEST WALLET HOLDER", project: "PRJ-1",
    project_name: "Test Lakeview", uploaded_by: "walk-accountant@example.com", uploaded_by_name: "Walk Accountant",
    bill_file: "/private/files/bill.pdf",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
});

const settle = async () => {
    for (let i = 0; i < 5; i++) await act(() => new Promise<void>((r) => setTimeout(r, 10)));
};

const fieldLabelled = <T extends HTMLElement>(text: string): T => {
    const label = Array.from(document.querySelectorAll("label")).find((el) => el.textContent?.replace("*", "").trim() === text);
    return document.getElementById(label!.htmlFor) as T;
};

const type = (field: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(() => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
    });

const press = async (label: string) => {
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label)!;
    act(() => button.click());
    await settle();
};

describe("Approve bill", () => {
    it("starts from the row's number and date, and approves with what the person corrected", async () => {
        const sent: unknown[] = [];
        act(() => root.render(<ApproveBillDialog row={ROW} submitting={false} onSubmit={(v) => sent.push(v)} onClose={() => undefined} />));

        expect(fieldLabelled<HTMLInputElement>("Invoice number").value).toBe("TYPED-3");
        expect(fieldLabelled<HTMLInputElement>("Invoice date").value).toBe("2026-09-04");

        type(fieldLabelled("Invoice number"), " INV-77 ");
        await press("Approve");
        expect(sent).toEqual([{ invoice_no: "INV-77", invoice_date: "2026-09-04" }]);
    });

    it("refuses an invoice date after today", async () => {
        const sent: unknown[] = [];
        act(() => root.render(<ApproveBillDialog row={ROW} submitting={false} onSubmit={(v) => sent.push(v)} onClose={() => undefined} />));

        type(fieldLabelled("Invoice date"), "2999-01-01");
        await press("Approve");
        expect(sent).toEqual([]);
        expect(document.body.textContent).toContain("The invoice date cannot be after today.");
    });
});

describe("Reject bill", () => {
    it("asks for a reason before rejecting, and rejects with it", async () => {
        const sent: unknown[] = [];
        act(() => root.render(<RejectBillDialog row={ROW} submitting={false} onSubmit={(v) => sent.push(v)} onClose={() => undefined} />));

        type(fieldLabelled("Reason"), "   ");
        await press("Reject");
        expect(sent).toEqual([]);
        expect(document.body.textContent).toContain("Say why the bill is rejected.");

        type(fieldLabelled("Reason"), " Bill of another shop ");
        await press("Reject");
        expect(sent).toEqual([{ reason: "Bill of another shop" }]);
    });
});
