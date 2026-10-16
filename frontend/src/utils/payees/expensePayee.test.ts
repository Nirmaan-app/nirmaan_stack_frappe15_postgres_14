import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    PAYEE_RULE,
    PAYEE_RULES,
    asPayeeRule,
    asksWhoGetsPaid,
    countAskingWhoGetsPaid,
    noAccountReviewLine,
    payeeAccountLine,
    showsWhoGetsPaid,
    whoGetsPaidHelp,
    whoGetsPaidProblem,
    whoGetsPaidView,
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
    const base = { rule: "Required", expenseType: "Labour Advance", vendor: null, vendorHasAccount: false, hasChoice: false };

    it("blocks a Required type with no payee", () => {
        expect(whoGetsPaidProblem(base)).toBe("Pick who gets paid, or add a new payee.");
        expect(whoGetsPaidProblem({ ...base, hasChoice: true })).toBeNull();
    });

    it("never blocks Optional or Not asked for a missing payee", () => {
        expect(whoGetsPaidProblem({ ...base, rule: "Optional" })).toBeNull();
        expect(whoGetsPaidProblem({ ...base, rule: "Not asked" })).toBeNull();
    });

    it("a vendor's own account satisfies the rule; a vendor without one blocks only Required", () => {
        expect(whoGetsPaidProblem({ ...base, vendor: "Shree Balaji", vendorHasAccount: true })).toBeNull();
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

/** The server pins the same options (`services/payees/test_expense_rules.py`): one list (F1). */
const SHARED = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../nirmaan_stack/services/payees/payee_rules_cases.json"), "utf-8"),
) as { payee_rules: string[] };

describe("parity with services/payees/expense_rules.py (shared cases)", () => {
    it("offers the server's rules, in its order", () => {
        expect(PAYEE_RULES).toEqual(SHARED.payee_rules);
    });
});

/** When the request dialog can't send (a screen rule since #1436: the server accepts all of these). */
const BLOCKS = [
    { name: "Required, no vendor, nobody picked", rule: "Required", vendor: null, account: false, picked: false, blocked: true },
    { name: "Required, no vendor, a payee picked", rule: "Required", vendor: null, account: false, picked: true, blocked: false },
    { name: "Optional, nobody picked", rule: "Optional", vendor: null, account: false, picked: false, blocked: false },
    { name: "Not asked, nobody picked", rule: "Not asked", vendor: null, account: false, picked: false, blocked: false },
    { name: "Required, a vendor with an account", rule: "Required", vendor: "VEN-1", account: true, picked: false, blocked: false },
    { name: "Required, a vendor with no account", rule: "Required", vendor: "VEN-1", account: false, picked: false, blocked: true },
    { name: "Optional, a vendor with no account", rule: "Optional", vendor: "VEN-1", account: false, picked: false, blocked: false },
    { name: "Not asked, a vendor with no account", rule: "Not asked", vendor: "VEN-1", account: false, picked: false, blocked: false },
    { name: "Not asked, a vendor with an account", rule: "Not asked", vendor: "VEN-1", account: true, picked: false, blocked: false },
];

describe("whoGetsPaidProblem cases", () => {
    it.each(BLOCKS)("$name", (c) => {
        const problem = whoGetsPaidProblem({
            rule: c.rule,
            expenseType: "Rent Expenses",
            vendor: c.vendor,
            vendorHasAccount: c.account,
            hasChoice: c.picked,
        });
        expect(problem !== null).toBe(c.blocked);
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

describe("noAccountReviewLine", () => {
    it("tells the reviewer a Required type's request has no account", () => {
        expect(noAccountReviewLine("Required", "Site Labour")).toBe("No account. Site Labour requires one.");
    });

    it("notes that an Optional type's request left it blank", () => {
        expect(noAccountReviewLine("Optional", "Travel")).toBe("No account (optional for Travel)");
    });

    it("says nothing for a Not asked type", () => {
        expect(noAccountReviewLine("Not asked", "Food")).toBeNull();
        expect(noAccountReviewLine(undefined, "Food")).toBeNull();
    });
});

/** The Add Expense dialogs (a Direct Expense, spec #1470): what "Who gets paid" shows and sends. */
describe("whoGetsPaidView", () => {
    const base = {
        rule: "Not asked", expenseType: "Food", typeChosen: true,
        vendor: null, vendorHasAccount: false, vendorAccountLoading: false,
        choice: { hasChoice: false, problem: null, adding: false },
    };

    it("a Not asked type with no vendor shows nothing, sends no payee and saves", () => {
        expect(whoGetsPaidView(base)).toEqual({ shows: false, sendsPayee: false, problem: null, ready: true });
    });

    it("shows nothing until a type is picked", () => {
        expect(whoGetsPaidView({ ...base, rule: "Required", typeChosen: false })).toEqual(
            { shows: false, sendsPayee: false, problem: null, ready: true },
        );
    });

    it("a vendor with an account shows it on any type, sends no payee, and waits for the read", () => {
        const vendor = { ...base, vendor: "Shree Balaji", vendorHasAccount: true };
        expect(whoGetsPaidView(vendor)).toEqual({ shows: true, sendsPayee: false, problem: null, ready: true });
        expect(whoGetsPaidView({ ...vendor, rule: "Required" }).ready).toBe(true);
        expect(whoGetsPaidView({ ...vendor, vendorHasAccount: false, vendorAccountLoading: true }).ready).toBe(false);
    });

    it("a vendor with no account blocks a Required type until the vendor is set to Others", () => {
        const vendor = { ...base, rule: "Required", vendor: "Shree Balaji" };
        expect(whoGetsPaidView(vendor)).toEqual({
            shows: true, sendsPayee: false, ready: false,
            problem: "Shree Balaji has no bank account on record. Add it on the vendor's page, or set Vendor to Others (No Vendor) and pick a payee.",
        });
        // A pick made under Others does not count while the vendor is named: the server ignores it.
        expect(whoGetsPaidView({ ...vendor, choice: { ...base.choice, hasChoice: true } }).ready).toBe(false);
        expect(whoGetsPaidView({ ...vendor, rule: "Optional" })).toMatchObject({ problem: null, ready: true });
    });

    it("with no vendor a Required type needs a pick, and the save sends it", () => {
        const others = { ...base, rule: "Required" };
        expect(whoGetsPaidView(others)).toEqual({
            shows: true, sendsPayee: true, ready: false, problem: "Pick who gets paid, or add a new payee.",
        });
        expect(whoGetsPaidView({ ...others, choice: { ...base.choice, hasChoice: true } })).toEqual(
            { shows: true, sendsPayee: true, problem: null, ready: true },
        );
    });

    it("an Optional type saves with nobody picked", () => {
        expect(whoGetsPaidView({ ...base, rule: "Optional" })).toEqual(
            { shows: true, sendsPayee: true, problem: null, ready: true },
        );
    });

    it("half-typed new payee details, or a payee being added, hold the save", () => {
        const optional = { ...base, rule: "Optional" };
        expect(whoGetsPaidView({ ...optional, choice: { ...base.choice, problem: "Type the account number again." } }).ready).toBe(false);
        expect(whoGetsPaidView({ ...optional, choice: { ...base.choice, hasChoice: true, adding: true } }).ready).toBe(false);
    });
});
