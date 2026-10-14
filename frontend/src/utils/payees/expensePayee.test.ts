import { describe, expect, it } from "vitest";

import {
    PAYEE_RULE,
    asPayeeRule,
    asksWhoGetsPaid,
    countAskingWhoGetsPaid,
    payeeAccountLine,
    payeeBankLine,
    timesPaidText,
    whoGetsPaidHelp,
    whoGetsPaidProblem,
} from "./expensePayee";

describe("asPayeeRule", () => {
    it("reads the three settings and treats anything else as Not asked (the default)", () => {
        expect(asPayeeRule("Required")).toBe(PAYEE_RULE.REQUIRED);
        expect(asPayeeRule("Optional")).toBe(PAYEE_RULE.OPTIONAL);
        expect(asPayeeRule("Not asked")).toBe(PAYEE_RULE.NOT_ASKED);
        expect(asPayeeRule(undefined)).toBe(PAYEE_RULE.NOT_ASKED);
        expect(asPayeeRule("")).toBe(PAYEE_RULE.NOT_ASKED);
    });
});

describe("asksWhoGetsPaid / countAskingWhoGetsPaid", () => {
    it("asks for Required and Optional, not for Not asked", () => {
        expect(asksWhoGetsPaid("Required")).toBe(true);
        expect(asksWhoGetsPaid("Optional")).toBe(true);
        expect(asksWhoGetsPaid("Not asked")).toBe(false);
        expect(asksWhoGetsPaid(null)).toBe(false);
    });

    it("counts the types that ask who gets paid", () => {
        const types = [{ payee_rule: "Required" }, { payee_rule: "Optional" }, { payee_rule: "Not asked" }, {}];
        expect(countAskingWhoGetsPaid(types)).toBe(2);
    });
});

describe("whoGetsPaidHelp", () => {
    it("names the type and says whether it may be left blank", () => {
        expect(whoGetsPaidHelp("Required", "Labour Advance")).toBe(
            "Required for Labour Advance. The accountant pays this account.",
        );
        expect(whoGetsPaidHelp("Optional", "Travel")).toBe(
            "Optional for Travel. Leave it blank if this is paid by card or cash.",
        );
    });
});

describe("whoGetsPaidProblem", () => {
    const base = { rule: "Required", expenseType: "Labour Advance", vendor: null, vendorPayee: null, hasChoice: false };

    it("blocks a Required type with no payee", () => {
        expect(whoGetsPaidProblem(base)).toBe("Pick who gets paid, or add a new payee.");
        expect(whoGetsPaidProblem({ ...base, hasChoice: true })).toBeNull();
    });

    it("never blocks Optional or Not asked for a missing payee", () => {
        expect(whoGetsPaidProblem({ ...base, rule: "Optional" })).toBeNull();
        expect(whoGetsPaidProblem({ ...base, rule: "Not asked" })).toBeNull();
    });

    it("a vendor's own payee satisfies the rule; a vendor without one blocks only Required", () => {
        expect(whoGetsPaidProblem({ ...base, vendor: "Shree Balaji", vendorPayee: "PYE-0007" })).toBeNull();
        expect(whoGetsPaidProblem({ ...base, vendor: "Shree Balaji" })).toBe(
            "Shree Balaji has no bank account on record. Add it on the vendor's page, or set Vendor to Others (No Vendor) and pick a payee.",
        );
        expect(whoGetsPaidProblem({ ...base, rule: "Optional", vendor: "Shree Balaji" })).toBeNull();
    });
});

describe("payee lines", () => {
    const payee = {
        account_number: "13512560000890",
        ifsc: "HDFC0001351",
        bank_name: "HDFC Bank",
        bank_branch: "Andheri East",
    };

    it("reads the account, IFSC, bank and branch as the mockup does", () => {
        expect(payeeAccountLine(payee)).toBe("A/c 13512560000890, IFSC HDFC0001351");
        expect(payeeBankLine(payee)).toBe("HDFC Bank, Andheri East");
        expect(payeeBankLine({ ...payee, bank_branch: null })).toBe("HDFC Bank");
        expect(payeeBankLine({ ...payee, bank_name: null, bank_branch: null })).toBe("");
    });

    it("says how often a payee has been paid", () => {
        expect(timesPaidText(14)).toBe("Paid 14 times before.");
        expect(timesPaidText(1)).toBe("Paid once before.");
        expect(timesPaidText(0)).toBe("Not paid before.");
    });
});
