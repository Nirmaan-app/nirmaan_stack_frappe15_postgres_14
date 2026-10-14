import { describe, expect, it } from "vitest";

import { holderNameWarning, isPayeePageTab, payeePageTabs } from "./payeePage";

describe("payeePageTabs", () => {
    it("opens on Payee Overview and carries the link counts on the other two labels", () => {
        expect(payeePageTabs({ vendors: 3, expenses: 2 })).toEqual([
            { key: "overview", label: "Payee Overview" },
            { key: "vendors", label: "Linked Vendors", count: 3 },
            { key: "expenses", label: "Linked Expenses", count: 2 },
        ]);
    });

    it("recognises only its own tab keys from the URL", () => {
        expect(isPayeePageTab("expenses")).toBe(true);
        expect(isPayeePageTab("payments")).toBe(false);
        expect(isPayeePageTab(null)).toBe(false);
    });
});

describe("holderNameWarning", () => {
    it("says how many vendors share the account", () => {
        expect(holderNameWarning(3)).toBe(
            "3 vendors are paid into this account. They will all show the new name, and so will past payments. " +
                "Change it only to fix how the bank spells it. A different person or company needs a new payee.",
        );
    });

    it("reads right for one vendor", () => {
        expect(holderNameWarning(1)).toMatch(/^1 vendor is paid into this account\. It will show the new name/);
    });

    it("still warns when no vendor uses the account", () => {
        expect(holderNameWarning(0)).toMatch(/^No vendor is paid into this account\. Every expense naming it will show the new name/);
        expect(holderNameWarning(0)).toContain("A different person or company needs a new payee.");
    });
});
