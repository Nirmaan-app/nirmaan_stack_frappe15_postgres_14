import { describe, expect, it } from "vitest";

import { isPayeePageTab, payeePageTabs } from "./payeePage";

describe("payeePageTabs", () => {
    it("opens on Payee Overview, then Linked Vendors and Linked User with their counts, and nothing else (#1434)", () => {
        expect(payeePageTabs({ vendors: 3, users: 1 })).toEqual([
            { key: "overview", label: "Payee Overview" },
            { key: "vendors", label: "Linked Vendors", count: 3 },
            { key: "user", label: "Linked User", count: 1 },
        ]);
    });

    it("counts no linked user when none is given", () => {
        expect(payeePageTabs({ vendors: 0 })[2]).toEqual({ key: "user", label: "Linked User", count: 0 });
    });

    it("recognises only its own tab keys from the URL", () => {
        expect(isPayeePageTab("vendors")).toBe(true);
        expect(isPayeePageTab("user")).toBe(true);
        expect(isPayeePageTab("expenses")).toBe(false);
        expect(isPayeePageTab("payments")).toBe(false);
        expect(isPayeePageTab(null)).toBe(false);
    });
});
