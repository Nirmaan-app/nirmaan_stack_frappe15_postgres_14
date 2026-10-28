// @vitest-environment jsdom
//
// The Porter Invoices step (Report Bulk Download only): Batch No, Validation Status and City are filters, every
// validation status is listed, and the summary totals fare (excl. GST) and fare + GST (incl. GST).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PorterInvoiceRow } from "../usePorterInvoices";
import { PorterInvoiceSteps } from "./PorterInvoiceSteps";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (name: string, status: string, date: string | null, fare: number, tax: number): PorterInvoiceRow => ({
    name, import_batch: "OFI-2025-00042", validation_status: status, city: "Bengaluru", completed_orders: 4,
    read_invoice_date: date, fare_total: fare, tax_total: tax, creation: "2025-11-01 10:00:00",
});
const ROWS = [
    row("PRT-BLR-0412", "Passed", "2025-09-30", 18420, 3316),
    row("PRT-BLR-0487", "Failed", "2025-10-31", 11250, 2025),
    row("PRT-CHN-0091", "Error", null, 4380, 788),
];

describe("Porter Invoices step", () => {
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

    const render = (selectedIds: string[], showFooter = true) =>
        act(() => root.render(
            <PorterInvoiceSteps items={ROWS} isLoading={false} selectedIds={selectedIds} onSelectAll={() => {}}
                onBack={() => {}} onDownload={() => {}} loading={false} showFooter={showFooter} />
        ));
    const blocks = () => [...container.querySelectorAll("[data-summary-label]")].map((l) => `${l.textContent}=${l.nextElementSibling?.textContent}`);

    it("offers Batch No, Validation Status and City filters, and lists every status", () => {
        render([]);
        const head = container.querySelector("thead")!.textContent!;
        for (const title of ["Batch No", "Validation Status", "City", "Invoice Date", "Fare (excl. GST)", "GST", "Total (incl. GST)"]) {
            expect(head, title).toContain(title);
        }
        const body = container.querySelector("tbody")!.textContent!;
        for (const status of ["Passed", "Failed", "Error"]) expect(body, status).toContain(status);
        expect(head).not.toContain("Project");
        expect(head).not.toContain("Vendor");
    });

    it("totals the ticked invoices: fare, and fare + GST; the date range skips an undated one", () => {
        render(["PRT-BLR-0412", "PRT-CHN-0091"]);
        expect(blocks()).toEqual([
            "Selected=2 of 3",
            "Date range (Invoice Date)=30-Sep-2025",
            "Excl. GST=₹22,800",
            "Incl. GST=₹26,904",
        ]);
    });

    it("hides its footer when the page shows Back and Download at the top", () => {
        render(["PRT-BLR-0412"], false);
        const footer = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Download 1 Invoice"))!.parentElement!;
        expect(footer.className).toContain("hidden");
    });
});
