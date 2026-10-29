// @vitest-environment jsdom
//
// The selection step has ONE Back / Download row, rendered by the page (the steps have no footer of their own).
// Reports > Bulk Download (the "all" scope) puts it at the top, with the 500-item warning right under it
// (owner, 2026-10-28). The project and vendor tabs keep it at the bottom and have no limit.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkDownloadScope } from "@/utils/bulkDownload/bulkDownloadTypes";
import { BulkDownloadPage } from "./BulkDownloadPage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ selectedIds: [] as string[], download: vi.fn(), back: vi.fn() }));
const PO_ROWS = Array.from({ length: 510 }, (_, i) => ({ name: `PO-${i}`, vendor_name: "ACE", status: "Approved", creation: "2025-06-02" }));

vi.mock("@/hooks/useUserData", () => ({ useUserData: () => ({ role: "Nirmaan Admin Profile", user_id: "admin@nirmaan.app" }) }));
vi.mock("@/components/common/BulkPdfDownloadButton", () => ({ BulkPdfDownloadButton: () => null }));
vi.mock("@/components/common/BulkDownloadProgressDialog", () => ({ BulkDownloadProgressDialog: () => null }));
vi.mock("./useBulkDownloadWizard", () => ({
    useBulkDownloadWizard: () => ({
        step: 2, docType: "PO", selectedIds: h.selectedIds, selectAll: () => {}, selectMultipleCriticalTaskPOs: () => {},
        goToStep2: () => {}, goBack: h.back, resetToTypeSelection: () => {}, downloadedCount: 0, downloadedLabel: "",
        poList: PO_ROWS, posLoading: false, woList: [], wosLoading: false, dnList: [], invoicesLoading: false,
        dcItems: [], mirItems: [], poDeliveryDocsLoading: false, criticalTasks: [], dnCriticalTasks: [],
        projectInvoiceItems: [], projectInvoicesLoading: false, poVoucherPayments: [], poVouchersLoading: false,
        woVoucherPayments: [], woVouchersLoading: false, mtcItems: [], mtcsLoading: false, withRate: true, setWithRate: () => {},
        itemCounts: {}, invoiceSubType: "All Invoices", setInvoiceSubType: () => {}, filteredInvoiceItems: () => [],
        loading: false, run: null, closeProgress: () => {}, handleDownload: h.download, cancelDownload: () => {},
    }),
}));

const ALL: BulkDownloadScope = { kind: "all", id: "", name: "All projects" };
const PROJECT: BulkDownloadScope = { kind: "project", id: "P-1", name: "Tower A" };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    // jsdom has no matchMedia (the wizard's step bar reads it); stubbed here, never in product code.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
    h.selectedIds = [];
    h.download.mockReset();
    h.back.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const render = (scope: BulkDownloadScope) => act(() => root.render(<BulkDownloadPage scope={scope} />));
const visibleButtons = (text: string) =>
    [...container.querySelectorAll("button")].filter((b) => b.textContent?.trim().startsWith(text) && !b.closest(".hidden"));

describe("Reports > Bulk Download: Back and Download in one row at the top", () => {
    it("shows ONE Back (left) and ONE Download (right) in the same row, and no step footer", () => {
        h.selectedIds = ["PO-1", "PO-2"];
        render(ALL);
        const [back] = visibleButtons("Back");
        const [download] = visibleButtons("Download 2 POs");
        expect(visibleButtons("Back")).toHaveLength(1);
        expect(visibleButtons("Download")).toHaveLength(1);
        expect(back.parentElement).toBe(download.parentElement);
        expect(back.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => download.click());
        expect(h.download).toHaveBeenCalledTimes(1);
        act(() => back.click());
        expect(h.back).toHaveBeenCalledTimes(1);
    });

    it("says 1 PO for one, and asks for a pick when nothing is ticked (disabled)", () => {
        h.selectedIds = ["PO-1"];
        render(ALL);
        expect(visibleButtons("Download 1 PO")).toHaveLength(1);
        act(() => root.unmount());
        root = createRoot(container);
        h.selectedIds = [];
        render(ALL);
        const [pick] = visibleButtons("Select POs to download");
        expect(pick.disabled).toBe(true);
    });

    it("over 500: the warning sits right under the top row and Download is disabled; exactly 500 is fine", () => {
        h.selectedIds = PO_ROWS.slice(0, 501).map((r) => r.name);
        render(ALL);
        const warning = container.querySelector('[role="alert"]')!;
        expect(warning.textContent).toContain("501 selected. One download takes up to 500.");
        const [download] = visibleButtons("Download 501 POs");
        expect(download.disabled).toBe(true);
        expect(warning.previousElementSibling).toBe(download.parentElement);
        act(() => root.unmount());
        root = createRoot(container);
        h.selectedIds = PO_ROWS.slice(0, 500).map((r) => r.name);
        render(ALL);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(visibleButtons("Download 500 POs")[0].disabled).toBe(false);
    });
});

describe("the project tab is unchanged", () => {
    it("keeps ONE Back + Download row at the bottom, under the table, and has no limit", () => {
        h.selectedIds = PO_ROWS.map((r) => r.name);
        render(PROJECT);
        expect(visibleButtons("Back")).toHaveLength(1);
        expect(visibleButtons("Download")).toHaveLength(1);
        const [download] = visibleButtons("Download 510 POs");
        expect(download.disabled).toBe(false);
        const table = container.querySelector("table")!;
        expect(table.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(container.querySelector('[role="alert"]')).toBeNull();
    }, 30_000); // the project tab renders all 510 rows unpaged: slow in jsdom under a full parallel run
});

describe("the header and step bar are shorter, same layout (all three tabs)", () => {
    const stepBar = () => [...container.querySelectorAll("div")].find((d) => d.className.includes("lg:[&_button]:gap-1"));

    it("keeps the title, subtitle and three steps, with the smaller sizes applied on desktop only", () => {
        for (const scope of [ALL, PROJECT, { kind: "vendor", id: "V-1", name: "ACE", vendorType: "Material" } as BulkDownloadScope]) {
            render(scope);
            const title = [...container.querySelectorAll("h3")].find((e) => e.textContent === "What would you like to download?")!;
            expect(title.className).toContain("text-base");
            expect(title.closest("div.px-6")!.className).toContain("py-1.5");
            expect(container.textContent).toContain("Choose a document type.");
            const bar = stepBar()!;
            expect(bar.className).toContain("lg:[&>div]:py-1.5");
            expect(bar.className).toContain("lg:[&_button>div]:h-7");
            // Every override is desktop-only (lg:), so the phone and tablet step bars are untouched.
            expect(bar.className.split(" ").filter((c) => c.includes("[&")).every((c) => c.startsWith("lg:"))).toBe(true);
            act(() => root.unmount());
            root = createRoot(container);
        }
    }, 30_000); // renders three tabs, two of them unpaged
});
