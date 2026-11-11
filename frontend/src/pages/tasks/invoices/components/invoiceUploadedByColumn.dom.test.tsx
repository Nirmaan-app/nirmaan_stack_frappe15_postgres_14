// @vitest-environment jsdom
//
// The "Invoice Uploaded By" cell on Vendor Invoice Recon's 2B Recon tabs (#1650): one line, cut with "…", the
// full text on hover, on both tabs (PO Invoices 2B Recon and WO Invoices 2B Recon). Each tab is rendered whole,
// with only the network faked, so the test reads the cell the table really draws.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PoInvoices } from "./PoInvoices";
import { SrInvoices } from "./SrInvoices";

class StubResizeObserver {
    observe() { /* no layout in jsdom */ }
    unobserve() { /* no layout in jsdom */ }
    disconnect() { /* no layout in jsdom */ }
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= StubResizeObserver;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The table draws only the rows its virtualizer sees on screen, and jsdom lays nothing out: give every box a size.
HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 900 });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1600 });

const LONG_NAME = "Parvathavardhini Venkatasubramanian Raghunathan";
const NO_NAME_EMAIL = "a.very.long.mailbox.name.for.testing@example-builders.test";

// Two made-up invoices: one uploaded by a user with a long full name, one by a user with no name.
const entry = (n: number, uploaded_by: string) => ({
    name: `VI-${n}`, amount: 1000 * n, reconciled_amount: 0, invoice_no: `INV-${n}`, date: "2026-10-01",
    uploaded_by, invoice_attachment_id: "", procurement_order: `PO/${n}/25-26`, service_request: `SR-${n}`,
    project: "PROJ-1", vendor: "VEN-1", vendor_name: "Made-up Vendor", reconciliation_status: "",
});
const ENTRIES = [entry(1, "pvr@example.test"), entry(2, NO_NAME_EMAIL)];
const USERS = [{ name: "pvr@example.test", full_name: LONG_NAME }, { name: NO_NAME_EMAIL, full_name: "" }];

vi.mock("frappe-react-sdk", () => {
    const idle = { data: undefined, isLoading: false, error: undefined, mutate: () => Promise.resolve() };
    return {
        useFrappeGetCall: (method: string) => method.includes("invoice_data")
            ? { ...idle, data: { message: { message: { invoice_entries: ENTRIES }, status: 200 } } }
            : idle,
        useFrappeGetDocList: (doctype: string) => ({ ...idle, data: doctype === "Nirmaan Users" ? USERS : [] }),
        useFrappeGetDoc: () => idle,
        useFrappePostCall: () => ({ call: () => Promise.resolve({}), loading: false }),
        useFrappeFileUpload: () => ({ upload: () => Promise.resolve({}), loading: false }),
        useFrappeDocTypeEventListener: () => undefined,
        useFrappeEventListener: () => undefined,
        useFrappeAuth: () => ({ currentUser: "accountant@example.test" }),
        useSWRConfig: () => ({ mutate: () => Promise.resolve() }),
        FrappeContext: { Provider: ({ children }: { children: unknown }) => children },
    };
});
vi.mock("@/hooks/useUserData", () => ({
    useUserData: () => ({ role: "Nirmaan Accountant Profile", user_id: "accountant@example.test" }),
}));

const TABS = {
    "PO Invoices 2B Recon": () => <PoInvoices />,
    "WO Invoices 2B Recon": () => <SrInvoices />,
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

/** The cell element that carries the text, pretending the browser laid it out too narrow for it. */
const cutText = (text: string) => {
    const el = Array.from(container.querySelectorAll<HTMLElement>("td *")).find((e) => e.textContent === text && e.children.length === 0);
    expect(el, `a table cell holding "${text}"`).toBeTruthy();
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: 400 });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 140 });
    return el!;
};

describe.each(Object.keys(TABS) as (keyof typeof TABS)[])("Invoice Uploaded By on %s", (tab) => {
    it.each([
        ["the uploader's full name", LONG_NAME],
        ["the email, when the uploader has no name", NO_NAME_EMAIL],
    ])("shows %s on one line, cut with an ellipsis, the full text on hover", (_what, shown) => {
        const Tab = TABS[tab];
        act(() => root.render(<MemoryRouter><Tab /></MemoryRouter>));
        const el = cutText(shown);
        expect(el.classList).toContain("truncate");

        // A hover and a keyboard focus open the same tooltip; jsdom has no pointer, so focus it.
        act(() => { el.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
        expect(Array.from(document.querySelectorAll('[role="tooltip"]')).map((t) => t.textContent)).toContain(shown);
    });
});
