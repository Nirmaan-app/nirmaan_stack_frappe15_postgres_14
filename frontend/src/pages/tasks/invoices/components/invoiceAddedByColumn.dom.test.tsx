// @vitest-environment jsdom
//
// The "Invoice Added By" cell in Vendor Invoice Recon (#1647): one line, cut with "…", the full text on hover,
// on both tables that show it (Pending Invoice Approvals and All Invoices).
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { getPendingTaskColumns, getTaskHistoryColumns } from "./columns";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_NAME = "Parvathavardhini Venkatasubramanian Raghunathan";
const NO_NAME_EMAIL = "a.very.long.mailbox.name.for.testing@example-builders.test";
const USERS: Record<string, string> = { "pvr@example.test": LONG_NAME };
const getUserName = (id: string | undefined) => (id && USERS[id]) || id || "";

const invoice = (uploaded_by: string): VendorInvoice =>
    ({ name: "VI-1", document_type: "Procurement Orders", document_name: "PO/1/25-26", uploaded_by, status: "Pending" }) as VendorInvoice;

const TABLES: Record<string, ColumnDef<VendorInvoice>[]> = {
    "Pending Invoice Approvals": getPendingTaskColumns(() => undefined, null, false, {}, undefined, undefined, undefined, undefined, undefined, getUserName),
    "All Invoices": getTaskHistoryColumns(getUserName),
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
});

const renderAddedBy = (columns: ColumnDef<VendorInvoice>[], uploaded_by: string) => {
    const column = columns.find((c) => c.id === "uploaded_by");
    const cell = column?.cell as (ctx: CellContext<VendorInvoice, unknown>) => React.ReactNode;
    const ctx = { row: { original: invoice(uploaded_by) } } as unknown as CellContext<VendorInvoice, unknown>;
    act(() => root.render(<MemoryRouter>{cell(ctx)}</MemoryRouter>));
};

/** The element that carries the text, pretending the browser laid it out too narrow for it. */
const cutText = (text: string) => {
    const el = Array.from(container.querySelectorAll<HTMLElement>("*")).find((e) => e.textContent === text && e.children.length === 0);
    expect(el, `an element holding "${text}"`).toBeTruthy();
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: 400 });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 140 });
    return el!;
};

describe.each(Object.keys(TABLES))("Invoice Added By on %s", (table) => {
    it.each([
        ["the uploader's full name", "pvr@example.test", LONG_NAME],
        ["the email, when the uploader has no name", NO_NAME_EMAIL, NO_NAME_EMAIL],
    ])("shows %s on one line, cut with an ellipsis, the full text on hover", (_what, uploaded_by, shown) => {
        renderAddedBy(TABLES[table], uploaded_by);
        const el = cutText(shown);
        expect(el.classList).toContain("truncate");

        // A hover and a keyboard focus open the same tooltip; jsdom has no pointer, so focus it.
        act(() => { el.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
        expect(Array.from(document.querySelectorAll('[role="tooltip"]')).map((t) => t.textContent)).toContain(shown);
    });
});
