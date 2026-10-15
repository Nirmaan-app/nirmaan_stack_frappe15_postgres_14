import { describe, expect, it } from "vitest";

import { isPayeePageTab, payeePageTabs } from "./payeePage";

describe("payeePageTabs", () => {
    it("opens on Payee Overview, then Linked Vendors with its count, and nothing else (#1434)", () => {
        expect(payeePageTabs({ vendors: 3 })).toEqual([
            { key: "overview", label: "Payee Overview" },
            { key: "vendors", label: "Linked Vendors", count: 3 },
        ]);
    });

    it("recognises only its own tab keys from the URL", () => {
        expect(isPayeePageTab("vendors")).toBe(true);
        expect(isPayeePageTab("expenses")).toBe(false);
        expect(isPayeePageTab("payments")).toBe(false);
        expect(isPayeePageTab(null)).toBe(false);
    });
});
