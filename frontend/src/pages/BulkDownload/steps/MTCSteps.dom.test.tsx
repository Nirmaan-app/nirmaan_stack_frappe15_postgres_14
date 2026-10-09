// @vitest-environment jsdom
//
// MTC ids (`MTC-26-00001`) are never shown to users (material-test-certificates.md, owner) -- that
// includes what a screen reader reads out. The selection table labelled every row's checkbox
// "Select <row name>", which on the MTC step read the certificate's id; a certificate is named by
// the items it covers instead.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MTCRow } from "../useBulkDownloadWizard";
import { MTCSteps } from "./MTCSteps";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mtc = (name: string, items: MTCRow["items"]): MTCRow => ({
    name, procurement_order: "PO/001/00042/26-27", project: "P-1", project_name: "Tower A",
    vendor: "VEN-1", vendor_name: "Vendor One", attachment: `/private/files/${name}.pdf`,
    certificate_date: "2026-10-07", owner: "someone@nirmaan.app", creation: "2026-10-07 17:02:00", items,
});
const ROWS = [
    mtc("MTC-26-00001", [{ item_id: "I1", item_name: "Copper Cable", make: "Polycab" }, { item_id: "I2", item_name: "Cable Tray" }]),
    mtc("MTC-26-00002", [{ item_id: "I3", item_name: "GI Pipe" }]),
];

describe("MTC step", () => {
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

    const render = (selectedIds: string[]) =>
        act(() => root.render(
            <MTCSteps items={ROWS} isLoading={false} selectedIds={selectedIds} onSelectAll={() => {}}
                onBack={() => {}} onDownload={() => {}} loading={false} scopeKind="vendor" />
        ));

    it("names each row's checkbox by the items it covers", () => {
        render([]);
        const labels = [...container.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));
        expect(labels).toContain("Select Copper Cable (Polycab), Cable Tray");
        expect(labels).toContain("Select GI Pipe");
    });

    it("never puts an MTC id anywhere in the page, text or attributes, with or without a selection", () => {
        for (const selected of [[], ["MTC-26-00001"], ["MTC-26-00001", "MTC-26-00002"]]) {
            render(selected);
            expect(container.innerHTML, `selected ${selected.length}`).not.toContain("MTC-26-");
        }
    });
});
