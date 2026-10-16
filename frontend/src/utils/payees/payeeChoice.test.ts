import { describe, expect, it } from "vitest";

import { PAYEE_MATCH, type PayeeSuggestion } from "@/types/NirmaanStack/Payee";

import {
    accountLine,
    MATCH_LABEL,
    suggestionLinkLine,
    VENDOR_PAYEE_MODE,
    vendorPayeeAnswer,
    vendorPayeeProblem,
} from "./payeeChoice";

const vendor = (name: string, city: string | null, pan: string | null = "AAHCK1234M", vendorName = "Kaveri Ductfab") => ({
    name,
    vendor_name: vendorName,
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
    vendors: 3,
    linked_vendors: [vendor("V1", "Rohtak"), vendor("V2", "Gujarat"), vendor("V3", "Bengaluru")],
    match: PAYEE_MATCH.STRONG,
    ...over,
});

describe("payee suggestion lines", () => {
    it("labels the two match strengths as the mockup does", () => {
        expect(MATCH_LABEL[PAYEE_MATCH.STRONG]).toBe("Strong match");
        expect(MATCH_LABEL[PAYEE_MATCH.NAME_ONLY]).toBe("Name only");
    });

    it("reads the account as ID, number, IFSC, bank and branch", () => {
        expect(accountLine(suggestion())).toBe("PYE-0412, A/c 50200061234567, HDFC0000195, HDFC Bank, Rohtak");
        expect(accountLine(suggestion({ bank_name: null, bank_branch: null }))).toBe(
            "PYE-0412, A/c 50200061234567, HDFC0000195",
        );
    });

    it("a strong match says the PAN agrees and names its vendors, with their places (spec story 26)", () => {
        expect(suggestionLinkLine(suggestion(), "AAHCK1234M")).toBe(
            "Same PAN as its linked vendors. Linked to 3 vendors: Kaveri Ductfab (Rohtak), Kaveri Ductfab (Gujarat), Kaveri Ductfab (Bengaluru).",
        );
    });

    it("a name-only match says the PAN differs and names its vendors", () => {
        const s = suggestion({
            match: PAYEE_MATCH.NAME_ONLY,
            vendors: 1,
            linked_vendors: [vendor("V9", "Nashik", "ZZZZZ9999Z")],
        });
        expect(suggestionLinkLine(s, "AAHCK1234M")).toBe("Different PAN. Linked to 1 vendor: Kaveri Ductfab (Nashik).");
    });

    it("says nothing about PAN until the new vendor's PAN is typed (#1420 walk C2)", () => {
        const s = suggestion({
            match: PAYEE_MATCH.NAME_ONLY,
            vendors: 1,
            linked_vendors: [vendor("V9", "Nashik", "ZZZZZ9999Z")],
        });
        expect(suggestionLinkLine(s, "")).toBe("Linked to 1 vendor: Kaveri Ductfab (Nashik).");
        expect(suggestionLinkLine(s, undefined)).toBe("Linked to 1 vendor: Kaveri Ductfab (Nashik).");
    });

    it("a name-only match with no PAN to compare says nothing about PAN", () => {
        const s = suggestion({ match: PAYEE_MATCH.NAME_ONLY, vendors: 0, linked_vendors: [] });
        expect(suggestionLinkLine(s, "AAHCK1234M")).toBe("No vendor is linked to it yet.");
    });

    it("never says 'paid' for links: a linked Payee may never have been paid (#1420 walk C11)", () => {
        expect(suggestionLinkLine(suggestion(), "AAHCK1234M")).not.toMatch(/paid/i);
    });

    it("leaves the city out when the vendor's name already says it", () => {
        const s = suggestion({
            vendors: 1,
            linked_vendors: [vendor("V1", "ROHTAK", "AAHCK1234M", "D.S. Ductofab Systems Pvt. Ltd. (Rohtak)")],
        });
        expect(suggestionLinkLine(s, "")).toBe("Same PAN as its linked vendors. Linked to 1 vendor: D.S. Ductofab Systems Pvt. Ltd. (Rohtak).");
    });

    it("names a vendor with no city by its name alone, and one with no name by its ID", () => {
        const s = suggestion({
            vendors: 3,
            linked_vendors: [
                vendor("V1", "VALSAD", "AAHCK1234M", "Kaveri Ductfab Systems"),
                vendor("V2", null, "AAHCK1234M", "KDS"),
                { ...vendor("VEN-Material-0175", null), vendor_name: null },
            ],
        });
        expect(suggestionLinkLine(s, "AAHCK1234M")).toBe(
            "Same PAN as its linked vendors. Linked to 3 vendors: Kaveri Ductfab Systems (VALSAD), KDS, VEN-Material-0175.",
        );
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
