import { describe, expect, it } from "vitest";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import {
    accountNumberDuplicateMessage,
    findVendorByGst,
    findVendorsByAccountNumber,
    normalizeAccountNumber,
    vendorNamesLabel,
} from "./vendorDuplicates";

const vendor = (over: Partial<Vendors>): Vendors =>
    ({
        name: "VEN-Material-0001",
        vendor_name: "Acme",
        vendor_type: "Material",
        creation: "",
        modified: "",
        owner: "",
        modified_by: "",
        ...over,
    } as Vendors);

// Real production shape: one company registered per state, sharing one account.
const ductofab = [
    vendor({ name: "V1", vendor_name: "D.S. Ductofab (Bengaluru)", account_number: "50200051045430", vendor_gst: "29AAA0000A1Z5" }),
    vendor({ name: "V2", vendor_name: "D.S. Ductofab (Rohtak)", account_number: "50200051045430", vendor_gst: "06AAA0000A1Z5" }),
    vendor({ name: "V3", vendor_name: "Unrelated Traders", account_number: "12345678901", vendor_gst: "27BBB0000B1Z5" }),
];

describe("normalizeAccountNumber", () => {
    it("strips spaces and dashes so typed variants match", () => {
        expect(normalizeAccountNumber("5020 0051-045430")).toBe("50200051045430");
    });

    it("handles the numeric shape the doctype also allows", () => {
        expect(normalizeAccountNumber(50200051045430)).toBe("50200051045430");
    });

    it("treats null/undefined as empty", () => {
        expect(normalizeAccountNumber(null)).toBe("");
        expect(normalizeAccountNumber(undefined)).toBe("");
    });
});

describe("findVendorsByAccountNumber", () => {
    it("returns every vendor sharing the account number", () => {
        const hits = findVendorsByAccountNumber(ductofab, "50200051045430");
        expect(hits.map((v) => v.name)).toEqual(["V1", "V2"]);
    });

    it("matches through spacing differences", () => {
        expect(findVendorsByAccountNumber(ductofab, "50200051 045430")).toHaveLength(2);
    });

    it("stays silent below the minimum length, so it never fires mid-typing", () => {
        expect(findVendorsByAccountNumber(ductofab, "50200")).toEqual([]);
    });

    it("returns nothing for a fresh account number", () => {
        expect(findVendorsByAccountNumber(ductofab, "99988877766")).toEqual([]);
    });

    it("tolerates an unloaded vendor list", () => {
        expect(findVendorsByAccountNumber(undefined, "50200051045430")).toEqual([]);
    });
});

describe("findVendorByGst", () => {
    it("names the vendor already holding the GST", () => {
        expect(findVendorByGst(ductofab, "06AAA0000A1Z5")?.vendor_name).toBe("D.S. Ductofab (Rohtak)");
    });

    it("returns undefined for an unused GST", () => {
        expect(findVendorByGst(ductofab, "33ZZZ0000Z1Z5")).toBeUndefined();
    });

    it("never matches on a blank value", () => {
        expect(findVendorByGst([...ductofab, vendor({ name: "V4", vendor_gst: "" })], "")).toBeUndefined();
    });
});

describe("vendorNamesLabel", () => {
    it("renders one, two and three names readably", () => {
        expect(vendorNamesLabel([ductofab[0]])).toBe("D.S. Ductofab (Bengaluru)");
        expect(vendorNamesLabel(ductofab.slice(0, 2))).toBe(
            "D.S. Ductofab (Bengaluru) and D.S. Ductofab (Rohtak)"
        );
        expect(vendorNamesLabel(ductofab)).toBe(
            "D.S. Ductofab (Bengaluru), D.S. Ductofab (Rohtak) and Unrelated Traders"
        );
    });

    it("falls back to the vendor id when the name is blank", () => {
        expect(vendorNamesLabel([vendor({ name: "VEN-Material-0009", vendor_name: "" })])).toBe(
            "VEN-Material-0009"
        );
    });

    it("returns an empty string for no matches", () => {
        expect(vendorNamesLabel([])).toBe("");
    });
});

describe("accountNumberDuplicateMessage", () => {
    it("blocks a number already held by another vendor, naming them", () => {
        expect(accountNumberDuplicateMessage(ductofab, "50200051045430")).toBe(
            "This account number is already registered to D.S. Ductofab (Bengaluru) and D.S. Ductofab (Rohtak)."
        );
    });

    it("allows a number nobody holds", () => {
        expect(accountNumberDuplicateMessage(ductofab, "99988877766")).toBeNull();
    });

    // The exemption that keeps the 19 real shared-account vendors editable.
    it("allows a vendor to KEEP the number it already holds", () => {
        expect(
            accountNumberDuplicateMessage(ductofab, "50200051045430", "50200051045430")
        ).toBeNull();
    });

    it("still blocks when an edit points at a DIFFERENT vendor's number", () => {
        expect(
            accountNumberDuplicateMessage(ductofab, "50200051045430", "11112222333")
        ).not.toBeNull();
    });

    it("applies the exemption through spacing differences", () => {
        expect(
            accountNumberDuplicateMessage(ductofab, "50200051 045430", "50200051045430")
        ).toBeNull();
    });

    it("says nothing for an empty value (requiredness is a separate rule)", () => {
        expect(accountNumberDuplicateMessage(ductofab, "")).toBeNull();
        expect(accountNumberDuplicateMessage(ductofab, undefined)).toBeNull();
    });

    it("stays silent below the match length, so it never blocks mid-typing", () => {
        expect(accountNumberDuplicateMessage(ductofab, "50200")).toBeNull();
    });
});
