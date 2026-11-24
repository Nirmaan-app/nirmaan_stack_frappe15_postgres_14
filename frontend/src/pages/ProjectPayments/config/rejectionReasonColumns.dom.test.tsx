// @vitest-environment jsdom
/**
 * The rejection reason on screen (2026-11-12): the Reason column (All Payments, Payment Raised By Me), the
 * Rejected view's "Open PO" / "Open WO" link, the "Rejected on" column, and the reason icon beside a Rejected
 * payment on the PO / WO page (2026-11-17). Rendered and read the way a user sees them.
 */
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { FrappeContext, type FrappeConfig } from "@/lib/frappe";
import { describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { RejectionReasonNote } from "../components/RejectionReasonNote";
import { useByMeView } from "../hooks/useByMeView";
import { buildApprovalColumns, type ApprovalColumnCtx } from "./approvalColumns";
import type { ApprovalQueueRow } from "./approvalsTable.config";
import { BY_ME_VIEW_COLUMNS, BY_ME_VIEW_PARAM, BY_ME_VIEWS } from "./byMeViews.config";
import { buildApprovalExportColumns } from "./approvalExportColumns";
import { PP_TABS } from "./ppTabs.constants";

const REASON = "System rejected: Request is older than 30 days and was not approved.";

const baseCtx: ApprovalColumnCtx = { tab: PP_TABS.PAYMENT_BY_ME, projectLabels: new Map(), vendorLabels: new Map() };

const row = (over: Partial<ApprovalQueueRow>): ApprovalQueueRow => ({
    name: "PAY-TEST-1",
    source: "Vendor Payment",
    source_type: "PO Payment",
    doctype: "Project Payments",
    status: "Rejected",
    amount: 1000,
    against_primary: "PO/123/00045/25-26",
    against_full: "",
    document_name: "PO/123/00045/25-26",
    document_type: "Procurement Orders",
    vendor: "",
    project: "",
    bank_line_count: 0,
    rejection_reason: REASON,
    modified: "2026-11-01 02:00:05",
    ...over,
} as unknown as ApprovalQueueRow);

// The Against cell's document card reads the Frappe context; it fetches only when opened, so a stub is enough.
const FRAPPE = { url: "http://test.invalid", db: {}, call: {}, auth: {}, file: {}, app: {} } as unknown as FrappeConfig;

const render = (element: ReactElement) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(
        <FrappeContext.Provider value={FRAPPE}>
            <MemoryRouter>{element}</MemoryRouter>
        </FrappeContext.Provider>,
    ));
    const shown = {
        text: container.textContent ?? "",
        links: Array.from(container.querySelectorAll("a")).map((a) => ({ text: a.textContent, href: a.getAttribute("href") })),
        title: container.querySelector("[title]")?.getAttribute("title") ?? null,
    };
    act(() => root.unmount());
    return shown;
};

const cell = (id: string, r: ApprovalQueueRow, ctx: ApprovalColumnCtx = baseCtx, ids = BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.ALL]) => {
    const column = buildApprovalColumns(ids, ctx).find((c) => c.id === id);
    if (!column) throw new Error(`no ${id} column`);
    const Cell = column.cell as (c: { row: { original: ApprovalQueueRow } }) => ReactElement;
    return render(Cell({ row: { original: r } }));
};

describe("the Reason column", () => {
    it("shows a rejected payment's reason, whole text on hover", () => {
        const shown = cell("rejection_reason", row({}));
        expect(shown.text).toBe(REASON);
        expect(shown.title).toBe(REASON);
    });

    it("shows a person's typed reason the same way", () => {
        expect(cell("rejection_reason", row({ rejection_reason: "Rate not agreed" })).text).toBe("Rate not agreed");
    });

    it("hides a reason left over from an earlier reject once the payment is no longer Rejected (review finding 2)", () => {
        expect(cell("rejection_reason", row({ status: "Paid", rejection_reason: "Rate not agreed" })).text).toBe("—");
        expect(cell("rejection_reason", row({ status: "CEO Pending", rejection_reason: "Rate not agreed" })).text).toBe("—");
        const csv = buildApprovalExportColumns(baseCtx).find((c) => c.id === "rejection_reason");
        const meta = csv?.meta as { exportValue: (r: ApprovalQueueRow) => unknown };
        expect(meta.exportValue(row({ status: "Paid", rejection_reason: "Rate not agreed" }))).toBe("");
    });

    it("shows — for a row with no reason (another status, an expense, a reject from before the field)", () => {
        expect(cell("rejection_reason", row({ status: "Paid", rejection_reason: "" })).text).toBe("—");
        expect(cell("rejection_reason", row({ rejection_reason: undefined })).text).toBe("—");
        expect(cell("rejection_reason", row({ rejection_reason: "   " })).text).toBe("—");
    });

    it("is exported as Rejection Reason, once, in the CSV", () => {
        const csv = buildApprovalExportColumns(baseCtx).filter((c) => c.id === "rejection_reason");
        expect(csv).toHaveLength(1);
        const meta = csv[0].meta as { exportHeaderName: string; exportValue: (r: ApprovalQueueRow) => unknown };
        expect(meta.exportHeaderName).toBe("Rejection Reason");
        expect(meta.exportValue(row({}))).toBe(REASON);
        expect(meta.exportValue(row({ rejection_reason: undefined }))).toBe("");
    });
});

describe("Raised By Me → Rejected: the link to the order's page", () => {
    const rejectedCtx: ApprovalColumnCtx = { ...baseCtx, linkOrderPage: true };
    const rejectedIds = BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.REJECTED];

    it("offers Open PO to the PO's own page", () => {
        const { links } = cell("against_primary", row({}), rejectedCtx, rejectedIds);
        expect(links).toEqual([{ text: "Open PO", href: "/purchase-orders/PO&=123&=00045&=25-26" }]);
    });

    it("offers Open WO to the WO's approved view", () => {
        const wo = row({ against_primary: "SR-00190-001071", document_name: "SR-00190-001071", document_type: "Service Requests", source_type: "SR Payment" });
        const { links } = cell("against_primary", wo, rejectedCtx, rejectedIds);
        expect(links).toEqual([{ text: "Open WO", href: "/service-requests/SR-00190-001071?tab=approved-sr" }]);
    });

    it("offers no link on an expense row (it has no order)", () => {
        const expense = row({ source: "Non-Project", source_type: "Non-Project", doctype: "Non Project Expenses", document_name: "", document_type: "", against_primary: "Office rent" });
        expect(cell("against_primary", expense, rejectedCtx, rejectedIds).links).toEqual([]);
    });

    it("offers no link in the All view or on any other tab", () => {
        expect(cell("against_primary", row({})).links).toEqual([]);
        expect(cell("against_primary", row({}), { ...baseCtx, tab: PP_TABS.ALL_PAYMENTS }).links).toEqual([]);
    });
});

describe("Rejected on", () => {
    it("sorts on the union's `modified` and shows its date", () => {
        const column = buildApprovalColumns(BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.REJECTED], baseCtx).find((c) => c.id === "modified");
        expect(column).toBeDefined();
        expect(cell("modified", row({}), baseCtx, BY_ME_VIEW_COLUMNS[BY_ME_VIEWS.REJECTED]).text).toMatch(/2026/);
    });
});

describe("the PO / WO page's rejection reason icon", () => {
    // Radix's popper measures its anchor; jsdom has no ResizeObserver (stubbed here, never in product code).
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

    const mount = () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => root.render(<RejectionReasonNote payment={{ status: "Rejected", rejection_reason: REASON }} />));
        const button = container.querySelector("button");
        const done = () => { act(() => root.unmount()); container.remove(); };
        return { container, button, done };
    };

    it("is an icon beside the status, not text under it: the Status cell stays one badge wide (owner, 2026-11-17)", () => {
        const { container, button, done } = mount();
        expect(button?.getAttribute("aria-label")).toBe("Show rejection reason");
        expect(container.textContent).toBe("");
        expect(document.body.textContent).not.toContain(REASON);
        done();
    });

    it("opens the whole reason on hover and closes it when the pointer leaves", () => {
        const { button, done } = mount();
        act(() => { button?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
        expect(document.body.textContent).toContain(REASON);
        act(() => { button?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
        expect(document.body.textContent).not.toContain(REASON);
        done();
    });

    it("stays open after a click, even once the pointer leaves, and a second click closes it", () => {
        const { button, done } = mount();
        act(() => { button?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
        act(() => { button?.click(); });
        act(() => { button?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
        expect(document.body.textContent).toContain(REASON);
        act(() => { button?.click(); });
        expect(document.body.textContent).not.toContain(REASON);
        done();
    });

    it("shows nothing for a Rejected payment with no reason, or any other status", () => {
        expect(render(<RejectionReasonNote payment={{ status: "Rejected", rejection_reason: "" }} />).text).toBe("");
        expect(render(<RejectionReasonNote payment={{ status: "Requested", rejection_reason: REASON }} />).text).toBe("");
        expect(render(<RejectionReasonNote payment={{ status: "Paid" }} />).text).toBe("");
    });
});

describe("the view in the page link (review finding 10)", () => {
    let pick: ((view: (typeof BY_ME_VIEWS)[keyof typeof BY_ME_VIEWS]) => void) | null = null;
    const Probe = () => {
        const [view, setView] = useByMeView();
        pick = setView;
        return <span>{view}</span>;
    };
    const param = () => new URLSearchParams(window.location.search).get(BY_ME_VIEW_PARAM);

    it("is named for the tab, not the plain `view` other pages use", () => {
        expect(BY_ME_VIEW_PARAM).toBe("by_me_view");
    });

    it("follows the view while the tab is open, and is removed when the tab is left", () => {
        window.history.replaceState({}, "", "/project-payments?tab=Payment+By+Me");
        const container = document.createElement("div");
        const root = createRoot(container);
        act(() => root.render(<Probe />));
        expect(param()).toBeNull();               // All is no param at all
        act(() => pick?.(BY_ME_VIEWS.REJECTED));
        expect(param()).toBe("rejected");
        expect(container.textContent).toBe("rejected");
        act(() => root.unmount());                // leaving the tab
        expect(param()).toBeNull();
        expect(new URLSearchParams(window.location.search).get("tab")).toBe("Payment By Me");
    });

    it("opens the view a link names", () => {
        window.history.replaceState({}, "", "/project-payments?tab=Payment+By+Me&by_me_view=paid");
        const container = document.createElement("div");
        const root = createRoot(container);
        act(() => root.render(<Probe />));
        expect(container.textContent).toBe("paid");
        expect(param()).toBe("paid");
        act(() => root.unmount());
    });
});
