import { describe, expect, it } from "vitest";

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { holderNameChoiceHelp, renameNeedsPrompt, sharedAccountLine, vendorPayeeGateProblem } from "./vendorAccount";

describe("sharedAccountLine", () => {
    it("says how many other vendors are paid into the same account", () => {
        expect(sharedAccountLine(2)).toBe("2 other vendors are paid into the same account.");
        expect(sharedAccountLine(1)).toBe("1 other vendor is paid into the same account.");
    });

    it("says so when no other vendor shares it", () => {
        expect(sharedAccountLine(0)).toBe("No other vendor is paid into the same account.");
    });
});

describe("holderNameChoiceHelp", () => {
    it("warns that the vendors sharing the account will show the new name too", () => {
        expect(holderNameChoiceHelp(2)).toBe(
            "The bank now has the new name on the same account. 2 other vendors share this account and will " +
                "show the new name too.",
        );
        expect(holderNameChoiceHelp(1)).toMatch(/ 1 other vendor shares this account and will show/);
    });

    it("leaves the sharing out when only this vendor uses the account, and names no role (#1435)", () => {
        expect(holderNameChoiceHelp(0)).toBe("The bank now has the new name on the same account.");
    });
});

describe("renameNeedsPrompt", () => {
    const holder = "Kaveri Ductfab Systems Pvt. Ltd.";

    it("asks when a vendor with a Payee is renamed away from the holder name", () => {
        expect(renameNeedsPrompt({ before: holder, after: "Kaveri Airtech Pvt. Ltd.", holder })).toBe(true);
    });

    it("does not ask when the name did not change, spaces aside", () => {
        expect(renameNeedsPrompt({ before: holder, after: ` ${holder}  `, holder })).toBe(false);
    });

    it("does not ask when the vendor has no Payee", () => {
        expect(renameNeedsPrompt({ before: holder, after: "Kaveri Airtech", holder: null })).toBe(false);
    });

    it("does not ask when the new name already is the holder name", () => {
        expect(
            renameNeedsPrompt({ before: "Kaveri (Pune)", after: "kaveri ductfab  systems pvt. ltd.", holder }),
        ).toBe(false);
    });
});

describe("vendorPayeeGateProblem", () => {
    const payee: PayeeSummary = {
        name: "PYE-0412", account_name: "Kaveri Ductfab", account_number: "50200061234567", ifsc: "HDFC0000195",
        vendors: 1,
    };

    it("lets the request through once the vendor is known to have a Payee", () => {
        expect(vendorPayeeGateProblem({ vendorLabel: "Kaveri", payee, failed: false })).toBeNull();
    });

    it("blocks while the account is still loading", () => {
        expect(vendorPayeeGateProblem({ vendorLabel: "Kaveri", payee: undefined, failed: false })?.title).toBe(
            "Checking the bank account",
        );
    });

    it("blocks with its own reason when the read failed", () => {
        const problem = vendorPayeeGateProblem({ vendorLabel: "Kaveri", payee: undefined, failed: true });
        expect(problem?.title).toBe("Couldn't check the bank account");
        expect(problem?.description).toContain("Kaveri's bank account");
    });

    it("names the vendor without the stray spaces some vendor names carry (walk: 'ROYAL TRADERS 's')", () => {
        const problem = vendorPayeeGateProblem({ vendorLabel: "ROYAL TRADERS ", payee: undefined, failed: false });
        expect(problem?.description).toMatch(/^ROYAL TRADERS's bank account/);
        expect(vendorPayeeGateProblem({ vendorLabel: " ", payee: null, failed: false })?.description).toMatch(/^This vendor has/);
    });

    it("blocks a vendor with no Payee and says how to fix it", () => {
        const problem = vendorPayeeGateProblem({ vendorLabel: "Kaveri", payee: null, failed: false });
        expect(problem?.title).toBe("Bank details missing");
        expect(problem?.description).toContain("Add the vendor's bank account on the vendor page");
    });
});
