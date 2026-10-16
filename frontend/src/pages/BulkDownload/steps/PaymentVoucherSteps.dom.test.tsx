// @vitest-environment jsdom
//
// The two payment voucher steps. The wizard lists only payments that HAVE a voucher to download --
// paid PO payments (theirs is generated, as on the PO page) and paid WO payments with an uploaded
// one -- so every row can be ticked: no greyed rows, no Voucher or Status column.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentVoucherRow } from "../useBulkDownloadWizard";
import { PaymentVoucherSteps } from "./PaymentVoucherSteps";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pay = (name: string, extra: Partial<PaymentVoucherRow> = {}): PaymentVoucherRow => ({
    name, document_name: "PO/001/00042/26-27", vendor: "VEN-1", vendor_name: "Vendor One",
    project: "P-1", project_name: "Tower A", amount: 10000, utr: `UTR-${name}`, creation: "2026-09-01 10:00:00", ...extra,
});
const PO_ROWS = [pay("PAY-P1", { payment_date: "2026-09-01" }), pay("PAY-P3", { payment_date: "2026-09-03" })];
const WO_ROWS = [pay("PAY-W1", { document_name: "SR-1", voucher_attachment: "/files/v.pdf", payment_date: "2026-09-02" })];

describe("payment voucher steps", () => {
    let container: HTMLDivElement;
    let root: Root;
    const onSelectAll = vi.fn();
    beforeEach(() => {
        onSelectAll.mockReset();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const render = (kind: "PO" | "WO", items: PaymentVoucherRow[], selectedIds: string[] = []) =>
        act(() => root.render(
            <PaymentVoucherSteps kind={kind} items={items} isLoading={false} selectedIds={selectedIds} onSelectAll={onSelectAll}
                onBack={() => {}} onDownload={() => {}} loading={false} scopeKind="project" />
        ));
    const checkbox = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    const text = () => container.textContent ?? "";

    it("PO: every listed payment can be ticked, and 'select all' takes them all", () => {
        render("PO", PO_ROWS);
        expect(text()).toContain("Select PO Payment Vouchers");
        expect(text()).toContain("0/2 Selected");
        expect(checkbox("Select PAY-P1").disabled).toBe(false);
        expect(checkbox("Select PAY-P3").disabled).toBe(false);
        act(() => checkbox("Select all filtered rows").click());
        expect(onSelectAll).toHaveBeenLastCalledWith(["PAY-P1", "PAY-P3"]);
    });

    it("PO: no Status column (every row is Paid) and no 'cannot be ticked' note", () => {
        render("PO", PO_ROWS);
        const headers = [...container.querySelectorAll("th")].map((th) => th.textContent?.trim());
        expect(headers).toContain("PO ID");
        expect(headers).not.toContain("Status");
        expect(text()).not.toMatch(/not paid|without voucher|Missing/);
    });

    it("WO: no Voucher column and no 'cannot be ticked' note -- every listed payment has its voucher", () => {
        render("WO", WO_ROWS);
        expect(text()).toContain("Select WO Payment Vouchers");
        const headers = [...container.querySelectorAll("th")].map((th) => th.textContent?.trim());
        expect(headers).toContain("WO ID");
        expect(headers).not.toContain("Voucher");
        expect(text()).not.toMatch(/without voucher|not paid|Missing/);
        expect(checkbox("Select PAY-W1").disabled).toBe(false);
    });
});
