import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    accountNumberCsvCell,
    accountsMatch,
    bankLine,
    cleanAccountNumber,
    duplicateSentence,
    ifscShapeProblem,
    linkedVendorsLabel,
    newPayeeProblem,
    normalizeAccount,
    payeeFormProblem,
    sameAccountDetails,
    sameHolderName,
    squashHolderName,
    type PayeeFormValues,
} from "./payeeForm";

const form = (overrides: Partial<PayeeFormValues> = {}): PayeeFormValues => ({
    account_name: "Kaveri Ductfab Systems",
    account_number: "50200061234567",
    confirm_account_number: "50200061234567",
    ifsc: "HDFC0000195",
    ...overrides,
});

describe("accountNumberCsvCell (#1420 walk A8)", () => {
    it("writes the number as an Excel text formula, so leading zeros and long digits survive", () => {
        expect(accountNumberCsvCell("080901234567890123")).toBe('="080901234567890123"');
    });
    it("leaves a blank blank", () => {
        expect(accountNumberCsvCell("")).toBe("");
        expect(accountNumberCsvCell(null)).toBe("");
    });
});

describe("normalizeAccount", () => {
    it("ignores spaces, dashes and leading zeros, like the server", () => {
        expect(normalizeAccount("0050 2000-6123 4567")).toBe("50200061234567");
        expect(normalizeAccount("50200061234567")).toBe("50200061234567");
        expect(normalizeAccount("  ")).toBe("");
    });
});

describe("accountsMatch", () => {
    it("matches the confirmation typed with different spacing", () => {
        expect(accountsMatch(form({ confirm_account_number: "5020 0061 2345 67" }))).toBe(true);
    });
    it("refuses a confirmation that differs in any digit, including a leading zero", () => {
        expect(accountsMatch(form({ confirm_account_number: "50200061234568" }))).toBe(false);
        expect(accountsMatch(form({ confirm_account_number: "050200061234567" }))).toBe(false);
    });
    it("is false while both are empty", () => {
        expect(accountsMatch(form({ account_number: "", confirm_account_number: "" }))).toBe(false);
    });
});

describe("ifscShapeProblem (#1420 walk A11: the reason shows under the IFSC box)", () => {
    const SHAPE = /11 characters: four letters, a zero/;
    it("says nothing while the IFSC is still being typed", () => {
        expect(ifscShapeProblem("SBIN", { left: false })).toBeNull();
        expect(ifscShapeProblem("", { left: true })).toBeNull();
    });
    it("names the shape once 11 characters are typed", () => {
        expect(ifscShapeProblem("SBIN1234567", { left: false })).toMatch(SHAPE);
        expect(ifscShapeProblem("SBIN0005943", { left: false })).toBeNull();
    });
    it("names the shape when the box is left short", () => {
        expect(ifscShapeProblem("SBIN1234", { left: true })).toMatch(SHAPE);
    });
    it("uses the server's wording", () => {
        expect(ifscShapeProblem("SBIN1234", { left: true })).toBe(payeeFormProblem(form({ ifsc: "SBIN1234" }), { bankFound: true }));
    });
});

describe("payeeFormProblem", () => {
    it("is null for complete details whose IFSC was found", () => {
        expect(payeeFormProblem(form(), { bankFound: true })).toBeNull();
    });
    it("names the first missing or wrong field", () => {
        expect(payeeFormProblem(form({ account_name: " " }), { bankFound: true })).toMatch(/holder name/);
        expect(payeeFormProblem(form({ account_number: "" }), { bankFound: true })).toMatch(/account number/);
        expect(payeeFormProblem(form({ account_number: "5020/0061" , confirm_account_number: "5020/0061"}), { bankFound: true })).toMatch(
            /letters and digits/,
        );
        expect(payeeFormProblem(form({ confirm_account_number: "5" }), { bankFound: true })).toMatch(/don't match/);
        expect(payeeFormProblem(form({ ifsc: "HDFC195" }), { bankFound: true })).toMatch(/11 characters/);
        expect(payeeFormProblem(form(), { bankFound: false })).toMatch(/IFSC/);
    });
});

describe("linkedVendorsLabel", () => {
    it("counts the vendors linked to a payee, singular and plural; none is null", () => {
        expect(linkedVendorsLabel(3)).toBe("3 vendors");
        expect(linkedVendorsLabel(1)).toBe("1 vendor");
        expect(linkedVendorsLabel(0)).toBeNull();
    });
});

describe("duplicateSentence", () => {
    it("names the existing payee and what it is linked to", () => {
        expect(
            duplicateSentence({ name: "PYE-0412", account_name: "Kaveri Ductfab Systems Pvt. Ltd.", vendors: 3 }),
        ).toBe(
            "PYE-0412, Kaveri Ductfab Systems Pvt. Ltd., has the same account number and IFSC. It is linked to 3 vendors. Pick that payee instead of adding a new one.",
        );
        expect(duplicateSentence({ name: "PYE-0405", account_name: "Mahalaxmi Hardware", vendors: 0 })).toContain(
            "No vendor is linked to it yet.",
        );
    });

    it("on an edit, says to use a different account rather than pick that payee", () => {
        expect(
            duplicateSentence({ name: "PYE-0412", account_name: "Kaveri Ductfab Systems Pvt. Ltd.", vendors: 3 }, { editing: true }),
        ).toBe(
            "PYE-0412, Kaveri Ductfab Systems Pvt. Ltd., has the same account number and IFSC. It is linked to 3 vendors. Use a different account, or open that payee.",
        );
    });
});

/** Shared with the server's suite (`services/payees/test_rules.py`): one set of cases, two twins (F1). */
const SHARED = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../nirmaan_stack/services/payees/payee_rules_cases.json"), "utf-8"),
) as {
    details: { name: string; account_name: string; account_number: string; ifsc: string; problem: string | null }[];
    accounts: { typed: string; clean: string; normalized: string }[];
};

describe("parity with services/payees/rules.py (shared cases)", () => {
    it.each(SHARED.details)("$name", (c) => {
        const typed = {
            account_name: c.account_name,
            account_number: c.account_number,
            confirm_account_number: c.account_number,
            ifsc: c.ifsc,
        };
        expect(payeeFormProblem(typed, { bankFound: true })).toBe(c.problem);
    });

    it.each(SHARED.accounts)("cleans $typed as the server does", (c) => {
        expect(cleanAccountNumber(c.typed)).toBe(c.clean);
        expect(normalizeAccount(c.typed)).toBe(c.normalized);
    });
});

describe("newPayeeProblem", () => {
    it("waits for the IFSC lookup before anything else", () => {
        expect(newPayeeProblem({ formProblem: "Enter the IFSC.", duplicate: true, lookingUp: true })).toBe(
            "Wait for the IFSC lookup.",
        );
    });

    it("then the form's own problem, then a Payee already holding the account", () => {
        expect(newPayeeProblem({ formProblem: "Enter the IFSC.", duplicate: true, lookingUp: false })).toBe(
            "Enter the IFSC.",
        );
        expect(newPayeeProblem({ formProblem: null, duplicate: true, lookingUp: false })).toContain(
            "already a payee",
        );
        expect(newPayeeProblem({ formProblem: null, duplicate: false, lookingUp: false })).toBeNull();
    });
});

describe("bankLine", () => {
    it("joins the bank and branch, leaving out what is unknown", () => {
        expect(bankLine({ bank_name: "HDFC Bank", bank_branch: "Rohtak" })).toBe("HDFC Bank, Rohtak");
        expect(bankLine({ bank_name: "HDFC Bank", bank_branch: null })).toBe("HDFC Bank");
        expect(bankLine({})).toBe("");
    });
});

describe("sameAccountDetails", () => {
    const saved = { account_name: "Kaveri Ductfab Systems", account_number: "50200061234567", ifsc: "HDFC0000195" };

    it("is true for the same holder, number and IFSC, spacing, dashes and case aside", () => {
        expect(sameAccountDetails(saved, { ...saved, account_name: " Kaveri  Ductfab Systems " })).toBe(true);
        expect(sameAccountDetails(saved, { ...saved, account_number: "5020 0061-234567" })).toBe(true);
        expect(sameAccountDetails(saved, { ...saved, ifsc: "hdfc0000195 " })).toBe(true);
    });

    it("is false once the holder name, number or IFSC differs", () => {
        expect(sameAccountDetails(saved, { ...saved, account_name: "Kaveri Airtech" })).toBe(false);
        expect(sameAccountDetails(saved, { ...saved, account_number: "50200061234568" })).toBe(false);
        expect(sameAccountDetails(saved, { ...saved, ifsc: "HDFC0000196" })).toBe(false);
    });

    it("counts a leading zero: what is copied or saved is the number as written", () => {
        expect(sameAccountDetails(saved, { ...saved, account_number: "050200061234567" })).toBe(false);
    });

    it("counts a case-only holder-name edit as a change: the bank gets the name as written", () => {
        expect(sameAccountDetails(saved, { ...saved, account_name: "KAVERI DUCTFAB SYSTEMS" })).toBe(false);
    });

    it("tolerates a copy with a missing holder name, number or IFSC", () => {
        expect(sameAccountDetails(saved, { ...saved, account_name: null })).toBe(false);
        expect(sameAccountDetails({ ...saved, account_name: null }, { ...saved, account_name: undefined })).toBe(true);
        expect(sameAccountDetails(saved, { ...saved, account_number: null, ifsc: undefined })).toBe(false);
    });
});

describe("squashHolderName", () => {
    it("collapses and trims spacing, keeps case, and reads a missing name as blank", () => {
        expect(squashHolderName("  ABC   Traders ")).toBe("ABC Traders");
        expect(squashHolderName(null)).toBe("");
    });
});

describe("sameHolderName", () => {
    it("ignores spacing and case, never another name (the vendor rename prompt)", () => {
        expect(sameHolderName(" Kaveri  Ductfab ", "kaveri ductfab")).toBe(true);
        expect(sameHolderName("Kaveri Ductfab", "Kaveri Airtech")).toBe(false);
        expect(sameHolderName(null, "")).toBe(true);
    });
});
