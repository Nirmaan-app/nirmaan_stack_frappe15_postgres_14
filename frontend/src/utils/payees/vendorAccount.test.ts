import { describe, expect, it } from "vitest";

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
                "show the new name too. Only Accounts and Admins can do this.",
        );
        expect(holderNameChoiceHelp(1)).toMatch(/ 1 other vendor shares this account and will show/);
    });

    it("leaves the sharing out when only this vendor uses the account", () => {
        expect(holderNameChoiceHelp(0)).toBe(
            "The bank now has the new name on the same account. Only Accounts and Admins can do this.",
        );
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
    const account = { payee: "PYE-0412" };

    it("lets the request through once the vendor is known to have a Payee", () => {
        expect(vendorPayeeGateProblem({ vendorLabel: "Kaveri", account, failed: false })).toBeNull();
    });

    it("blocks while the account is still loading", () => {
        expect(vendorPayeeGateProblem({ vendorLabel: "Kaveri", account: undefined, failed: false })?.title).toBe(
            "Checking the bank account",
        );
    });

    it("blocks with its own reason when the read failed", () => {
        const problem = vendorPayeeGateProblem({ vendorLabel: "Kaveri", account: undefined, failed: true });
        expect(problem?.title).toBe("Couldn't check the bank account");
        expect(problem?.description).toContain("Kaveri's bank account");
    });

    it("blocks a vendor with no Payee and says how to fix it", () => {
        const problem = vendorPayeeGateProblem({ vendorLabel: "Kaveri", account: null, failed: false });
        expect(problem?.title).toBe("Bank details missing");
        expect(problem?.description).toContain("Add the vendor's bank account on the vendor page");
    });
});
