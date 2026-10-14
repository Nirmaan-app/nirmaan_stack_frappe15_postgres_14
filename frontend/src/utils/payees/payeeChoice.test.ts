import { describe, expect, it } from "vitest";

import { PAYEE_MATCH, type PayeeSuggestion } from "@/types/NirmaanStack/Payee";

import {
    accountLine,
    expensesLine,
    lastPaidLine,
    MATCH_LABEL,
    suggestionLinkLine,
    VENDOR_PAYEE_MODE,
    vendorPayeeAnswer,
    vendorPayeeProblem,
} from "./payeeChoice";

const vendor = (name: string, city: string | null, pan: string | null = "AAHCK1234M") => ({
    name,
    vendor_name: `Kaveri Ductfab (${city})`,
    vendor_city: city,
    vendor_pan: pan,
});

const suggestion = (over: Partial<PayeeSuggestion> = {}): PayeeSuggestion => ({
    name: "PYE-0412",
    account_name: "Kaveri Ductfab Systems Pvt. Ltd.",
    account_number: "50200061234567",
    ifsc: "HDFC0000195",
    bank_name: "HDFC Bank",
    bank_branch: "Rohtak",
    status: "Active",
    vendors: 3,
    expenses: 0,
    last_paid: "2026-10-08",
    linked_vendors: [vendor("V1", "Rohtak"), vendor("V2", "Gujarat"), vendor("V3", "Bengaluru")],
    linked_expenses: [],
    last_payment: { date: "2026-10-08", document: "PO/005/00107/26-27" },
    match: PAYEE_MATCH.STRONG,
    ...over,
});

describe("payee suggestion lines", () => {
    it("labels the two match strengths as the mockup does", () => {
        expect(MATCH_LABEL[PAYEE_MATCH.STRONG]).toBe("Strong match");
        expect(MATCH_LABEL[PAYEE_MATCH.NAME_ONLY]).toBe("Name only");
    });

    it("reads the account as ID, number, IFSC, bank and branch", () => {
        expect(accountLine(suggestion())).toBe("PYE-0412, A/c 50200061234567, HDFC0000195, HDFC Bank Rohtak");
        expect(accountLine(suggestion({ bank_name: null, bank_branch: null }))).toBe(
            "PYE-0412, A/c 50200061234567, HDFC0000195",
        );
    });

    it("a strong match says the PAN agrees and names its vendors' places", () => {
        expect(suggestionLinkLine(suggestion())).toBe(
            "Same PAN as its linked vendors. Paid by 3 vendors: Rohtak, Gujarat, Bengaluru.",
        );
    });

    it("a name-only match says the PAN differs and counts vendors and expenses", () => {
        const s = suggestion({
            match: PAYEE_MATCH.NAME_ONLY,
            vendors: 1,
            expenses: 2,
            linked_vendors: [vendor("V9", "Nashik", "ZZZZZ9999Z")],
        });
        expect(suggestionLinkLine(s)).toBe("Different PAN. Paid by 1 vendor and 2 expenses.");
    });

    it("a name-only match with no PAN to compare says nothing about PAN", () => {
        const s = suggestion({ match: PAYEE_MATCH.NAME_ONLY, vendors: 0, expenses: 0, linked_vendors: [] });
        expect(suggestionLinkLine(s)).toBe("Not linked to anything yet.");
    });

    it("names each place once, falling back to the vendor name", () => {
        const s = suggestion({
            vendors: 3,
            linked_vendors: [vendor("V1", "Pune"), vendor("V2", "Pune"), { ...vendor("V3", null), vendor_name: "KDS" }],
        });
        expect(suggestionLinkLine(s)).toBe("Same PAN as its linked vendors. Paid by 3 vendors: Pune, KDS.");
    });
});

describe("the vendor's answer to 'Where do we pay this vendor?'", () => {
    const typed = {
        account_name: "Kaveri Ductfab",
        account_number: "5020 0061-234567",
        confirm_account_number: "50200061234567",
        ifsc: " hdfc0000195",
    };

    it("an existing payee sends only its name", () => {
        expect(vendorPayeeAnswer({ mode: VENDOR_PAYEE_MODE.EXISTING, chosen: "PYE-0412", form: typed })).toEqual({
            payee: "PYE-0412",
        });
    });

    it("new details send the typed bank details, cleaned, and never the confirmation", () => {
        expect(vendorPayeeAnswer({ mode: VENDOR_PAYEE_MODE.NEW, chosen: "PYE-0412", form: typed })).toEqual({
            bank: { account_name: "Kaveri Ductfab", account_number: "50200061234567", ifsc: "HDFC0000195" },
        });
    });

    it("an existing payee must be picked", () => {
        const base = { formProblem: null, duplicate: false, lookingUp: false };
        expect(vendorPayeeProblem({ ...base, mode: VENDOR_PAYEE_MODE.EXISTING, chosen: null })).toBe(
            "Pick a payee from the matches, or enter new bank details.",
        );
        expect(vendorPayeeProblem({ ...base, mode: VENDOR_PAYEE_MODE.EXISTING, chosen: "PYE-1" })).toBeNull();
    });

    it("new details must be complete, looked up and not a duplicate", () => {
        const base = { mode: VENDOR_PAYEE_MODE.NEW, chosen: null, formProblem: null, duplicate: false, lookingUp: false };
        expect(vendorPayeeProblem({ ...base, formProblem: "Enter the IFSC." })).toBe("Enter the IFSC.");
        expect(vendorPayeeProblem({ ...base, duplicate: true })).toBe(
            "This account is already a payee. Use that payee instead of adding a new one.",
        );
        expect(vendorPayeeProblem({ ...base, lookingUp: true })).toBe("Wait for the IFSC lookup.");
        expect(vendorPayeeProblem(base)).toBeNull();
    });
});

describe("the confirmation's lines", () => {
    it("says when and on what the payee was last paid", () => {
        expect(lastPaidLine(suggestion())).toBe("Last paid 08-Oct-2026, on PO/005/00107/26-27.");
        expect(lastPaidLine(suggestion({ last_payment: null }))).toBe("Never paid yet.");
    });

    it("counts the linked expenses and names them", () => {
        const s = suggestion({
            linked_expenses: [
                { name: "PE-2026-00712", doctype: "Project Expenses" },
                { name: "NPE-2026-00093", doctype: "Non Project Expenses" },
            ],
        });
        expect(expensesLine(s)).toBe("2 (PE-2026-00712, NPE-2026-00093)");
        expect(expensesLine(suggestion())).toBeNull();
    });

    it("names at most five expenses", () => {
        const linked = Array.from({ length: 7 }, (_, i) => ({ name: `PE-${i}`, doctype: "Project Expenses" as const }));
        expect(expensesLine(suggestion({ linked_expenses: linked }))).toBe("7 (PE-0, PE-1, PE-2, PE-3, PE-4 and 2 more)");
    });
});
