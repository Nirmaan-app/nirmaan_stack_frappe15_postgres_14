import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    PAYEE_RULE,
    PAYEE_RULES,
    asPayeeRule,
    asksWhoGetsPaid,
    countAskingWhoGetsPaid,
    payeeAccountLine,
    showsWhoGetsPaid,
    vendorClearDropsPayee,
    whoGetsPaidHelp,
    whoGetsPaidProblem,
} from "./expensePayee";
import { bankLine } from "./payeeForm";

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
        expect(bankLine(payee)).toBe("HDFC Bank, Andheri East");
        expect(bankLine({ ...payee, bank_branch: null })).toBe("HDFC Bank");
        expect(bankLine({ ...payee, bank_name: null, bank_branch: null })).toBe("");
    });
});

/** Shared with the server's suite (`services/payees/test_expense_rules.py`): one set of cases (F1). */
const SHARED = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../nirmaan_stack/services/payees/payee_rules_cases.json"), "utf-8"),
) as {
    payee_rules: string[];
    requests: {
        name: string;
        rule: string;
        vendor: string | null;
        vendor_payee: string | null;
        payee: string | null;
        refused: boolean;
    }[];
};

describe("parity with services/payees/expense_rules.py (shared cases)", () => {
    it("offers the server's rules, in its order", () => {
        expect(PAYEE_RULES).toEqual(SHARED.payee_rules);
    });

    it.each(SHARED.requests)("$name: blocks sending exactly when the server refuses", (c) => {
        const problem = whoGetsPaidProblem({
            rule: c.rule,
            expenseType: "Rent Expenses",
            vendor: c.vendor,
            vendorPayee: c.vendor_payee,
            hasChoice: !!c.payee,
        });
        expect(problem !== null).toBe(c.refused);
    });
});

describe("showsWhoGetsPaid", () => {
    it("shows the section when the type asks", () => {
        expect(showsWhoGetsPaid("Required", false)).toBe(true);
        expect(showsWhoGetsPaid("Optional", false)).toBe(true);
    });

    it("shows a Not asked type's vendor account too, and nothing without a vendor", () => {
        expect(showsWhoGetsPaid("Not asked", true)).toBe(true);
        expect(showsWhoGetsPaid("Not asked", false)).toBe(false);
    });

    it("words the help line of a Not asked type", () => {
        expect(whoGetsPaidHelp("Not asked", "Material Purchase")).toBe(
            "Material Purchase doesn't ask who gets paid, but a vendor is paid into its own account.",
        );
    });
});

describe("vendorClearDropsPayee (walk bug 17, the server's D2 rule)", () => {
    it("drops the Payee the request was saved with through its vendor", () => {
        expect(vendorClearDropsPayee("PYE-0412", "PYE-0412")).toBe(true);
    });

    it("keeps any other pick, and nothing to drop is nothing", () => {
        expect(vendorClearDropsPayee("PYE-0007", "PYE-0412")).toBe(false);
        expect(vendorClearDropsPayee(null, "PYE-0412")).toBe(false);
        expect(vendorClearDropsPayee("PYE-0007", null)).toBe(false);
    });
});
