import { describe, expect, it } from "vitest";

import {
    deactivateText,
    deactivateVendorWarning,
    holderNameWarning,
    isPayeePageTab,
    payeePageTabs,
} from "./payeePage";

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

describe("deactivateText (Mark inactive)", () => {
    it("says one linked record keeps it (#1420 walk B9)", () => {
        expect(deactivateText({ vendors: 1, expenses: 0 })).toBe(
            "Nobody will be able to pick it for a vendor, an expense or an expense request. " +
                "The 1 vendor already pointing at it keeps it.",
        );
        expect(deactivateText({ vendors: 0, expenses: 1 })).toMatch(/The 1 expense already pointing at it keeps it\.$/);
    });

    it("says several linked records keep it", () => {
        expect(deactivateText({ vendors: 2, expenses: 0 })).toMatch(/The 2 vendors already pointing at it keep it\.$/);
        expect(deactivateText({ vendors: 1, expenses: 1 })).toMatch(/The 1 vendor and 1 expense already pointing at it keep it\.$/);
    });

    it("says nothing about links when there are none", () => {
        expect(deactivateText({ vendors: 0, expenses: 0 })).toBe(
            "Nobody will be able to pick it for a vendor, an expense or an expense request.",
        );
    });
});

describe("deactivateVendorWarning (owner decision, bug 7a)", () => {
    it("warns that the vendors still paid into it can't be paid until they change account", () => {
        expect(deactivateVendorWarning(1)).toBe(
            "1 vendor is still paid into this account. Until it uses Change account on its vendor page, no PO, " +
                "Work Order or Credits payment can be requested for it, and no new expense request can name it.",
        );
        expect(deactivateVendorWarning(3)).toMatch(/^3 vendors are still paid into this account\. Until each uses/);
    });

    it("is null with no vendor on it", () => {
        expect(deactivateVendorWarning(0)).toBeNull();
    });
});
