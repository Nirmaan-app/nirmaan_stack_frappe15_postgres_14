import { describe, expect, it } from "vitest";

import { holderNameWarning, isPayeePageTab, payeePageTabs } from "./payeePage";

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

describe("holderNameWarning", () => {
    it("says how many vendors share the account", () => {
        expect(holderNameWarning(3)).toBe(
            "3 vendors are paid into this account. They will all show the new name. " +
                "Change it only to fix how the bank spells it. A different person or company needs a new payee.",
        );
    });

    it("reads right for one vendor", () => {
        expect(holderNameWarning(1)).toMatch(/^1 vendor is paid into this account\. It will show the new name/);
    });

    it("still warns when no vendor uses the account", () => {
        expect(holderNameWarning(0)).toMatch(/^No vendor is paid into this account\. /);
        expect(holderNameWarning(0)).not.toMatch(/expense|past payments/);
        expect(holderNameWarning(0)).toContain("A different person or company needs a new payee.");
    });
});
