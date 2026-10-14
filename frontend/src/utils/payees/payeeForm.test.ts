import { describe, expect, it } from "vitest";

import {
    accountsMatch,
    duplicateSentence,
    linkedToLabels,
    normalizeAccount,
    payeeFormProblem,
    type PayeeFormValues,
} from "./payeeForm";

const form = (overrides: Partial<PayeeFormValues> = {}): PayeeFormValues => ({
    account_name: "Kaveri Ductfab Systems",
    account_number: "50200061234567",
    confirm_account_number: "50200061234567",
    ifsc: "HDFC0000195",
    ...overrides,
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

describe("linkedToLabels", () => {
    it("counts vendors and expenses, singular and plural", () => {
        expect(linkedToLabels({ vendors: 3, expenses: 2 })).toEqual(["3 vendors", "2 expenses"]);
        expect(linkedToLabels({ vendors: 1, expenses: 0 })).toEqual(["1 vendor"]);
        expect(linkedToLabels({ vendors: 0, expenses: 1 })).toEqual(["1 expense"]);
        expect(linkedToLabels({ vendors: 0, expenses: 0 })).toEqual([]);
    });
});

describe("duplicateSentence", () => {
    it("names the existing payee and what it is linked to", () => {
        expect(
            duplicateSentence({ name: "PYE-0412", account_name: "Kaveri Ductfab Systems Pvt. Ltd.", vendors: 3, expenses: 0 }),
        ).toBe(
            "PYE-0412, Kaveri Ductfab Systems Pvt. Ltd., has the same account number and IFSC. It is linked to 3 vendors. Pick that payee instead of adding a new one.",
        );
        expect(duplicateSentence({ name: "PYE-0405", account_name: "Mahalaxmi Hardware", vendors: 0, expenses: 0 })).toContain(
            "It is not linked to anything yet.",
        );
    });
});
