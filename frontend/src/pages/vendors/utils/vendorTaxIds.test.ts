import { describe, expect, it } from "vitest";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import {
    DEFAULT_TDS_RATE,
    fallbackTdsRate,
    isIndividualHufPan,
    isReadableTdsRate,
    tdsRateChangeNote,
    tdsRateHint,
    tdsRateMismatch,
    tdsRateOnPanChange,
    tdsRateToStore,
    vendorTaxIdSchemas,
} from "./vendorTaxIds";
// Shared with the server's suite (`services/test_vendor_tds.py`): one set of cases, two twins.
import TDS_SHARED from "../../../../../nirmaan_stack/services/vendor_tds_cases.json";

const vendor = (over: Partial<Vendors>): Vendors =>
    ({ name: "V", vendor_name: "Acme", creation: "", modified: "", owner: "", modified_by: "", ...over } as Vendors);

// Real production shape: a GST vendor, and the same business again as a PAN-only service vendor.
const existing = [
    vendor({ name: "G1", vendor_name: "Maa Santoshi Enterprises", vendor_gst: "29APNPR5521H1ZG", vendor_pan: "APNPR5521H" }),
    vendor({ name: "P1", vendor_name: "Raghubeer Singh", vendor_pan: "CZSPK2048F" }),
];

const errorsOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
    result.success ? [] : result.error!.issues.map((i) => i.message);

describe("vendorTaxIdSchemas", () => {
    it("requires GST for a Material vendor and optional for a Service vendor", () => {
        expect(vendorTaxIdSchemas(existing, false).vendor_gst.safeParse(undefined).success).toBe(false);
        expect(vendorTaxIdSchemas(existing, true).vendor_gst.safeParse(undefined).success).toBe(true);
    });

    it("requires PAN for every vendor, Service included", () => {
        expect(vendorTaxIdSchemas(existing, true).vendor_pan.safeParse(undefined).success).toBe(false);
    });

    // Owner call: the PAN is typed freely and never cross-checked against the GST number.
    it("does not check the PAN against the GST number", () => {
        expect(errorsOf(vendorTaxIdSchemas(existing, false).vendor_pan.safeParse("ZZZZZ9999Z"))).toEqual([]);
    });

    it("still rejects a badly formatted PAN", () => {
        expect(errorsOf(vendorTaxIdSchemas(existing, false).vendor_pan.safeParse("ABC123"))).toContain(
            "Invalid PAN format. Example: ABCDE1234F"
        );
    });

    // Owner call: a duplicate PAN only warns (findVendorsByPan) — it must never block, GST or no GST.
    it("never blocks a PAN another vendor already holds", () => {
        expect(errorsOf(vendorTaxIdSchemas(existing, true).vendor_pan.safeParse("CZSPK2048F"))).toEqual([]);
        expect(errorsOf(vendorTaxIdSchemas(existing, false).vendor_pan.safeParse("APNPR5521H"))).toEqual([]);
    });

    it("still blocks a duplicate GST number", () => {
        expect(errorsOf(vendorTaxIdSchemas(existing, false).vendor_gst.safeParse("29APNPR5521H1ZG"))).toContain(
            "This GST is already registered to Maa Santoshi Enterprises."
        );
    });
});

const TDS_CASES = TDS_SHARED.cases as {
    name: string; pan: string | null; rate: number | string | boolean | null; individual_huf: boolean; stored: number;
}[];

const INDIVIDUAL = "ABCPE1234F";
const HUF = "ABCHE1234F";
const COMPANY = "ABCCE1234F";

describe("parity with services/vendor_tds.py (shared cases)", () => {
    it.each(TDS_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
        expect(isIndividualHufPan(c.pan)).toBe(c.individual_huf);
        expect(Number(tdsRateToStore(c.pan, c.rate))).toBe(c.stored);
    });
});

describe("isReadableTdsRate", () => {
    it("reads numbers and plain decimal strings", () => {
        for (const rate of [0, 1, 2.5, "3", " 4.0 ", "0.5", ".5", "-1"]) {
            expect(isReadableTdsRate(rate)).toBe(true);
        }
    });

    it("does not read blanks, booleans, percent signs, words, hex or exponents", () => {
        for (const rate of [null, undefined, "", "  ", "2%", "abc", "0x2", "1e2", true, false, NaN, Infinity]) {
            expect(isReadableTdsRate(rate)).toBe(false);
        }
    });
});

describe("tdsRateOnPanChange", () => {
    it("sets 1% the moment an Individual or HUF PAN is whole, not before", () => {
        expect(tdsRateOnPanChange(undefined, "ABCPE1234", 2, DEFAULT_TDS_RATE)).toBeNull();
        expect(tdsRateOnPanChange("ABCPE1234", INDIVIDUAL, 2, DEFAULT_TDS_RATE)).toBe(1);
        expect(tdsRateOnPanChange("ABCHE1234", HUF, "3", DEFAULT_TDS_RATE)).toBe(1);
    });

    it("puts the fallback back when the PAN stops being an Individual's, even mid-edit", () => {
        expect(tdsRateOnPanChange(INDIVIDUAL, COMPANY, 1, DEFAULT_TDS_RATE)).toBe(2);
        // Deleting a character first: the PAN is invalid for a moment, and the lock lifts right then.
        expect(tdsRateOnPanChange(INDIVIDUAL, "ABCPE1234", 1, DEFAULT_TDS_RATE)).toBe(2);
        expect(tdsRateOnPanChange(INDIVIDUAL, COMPANY, 1, 3)).toBe(3);
    });

    it("never touches a company's rate while the PAN stays a company's", () => {
        expect(tdsRateOnPanChange(COMPANY, "ABCFE1234F", 4, DEFAULT_TDS_RATE)).toBeNull();
        expect(tdsRateOnPanChange("ABCCE1234", COMPANY, 1, DEFAULT_TDS_RATE)).toBeNull();
        expect(tdsRateOnPanChange(undefined, COMPANY, 3, DEFAULT_TDS_RATE)).toBeNull();
    });

    it("leaves a rate that is already right", () => {
        expect(tdsRateOnPanChange("ABCPE1234", INDIVIDUAL, "1", DEFAULT_TDS_RATE)).toBeNull();
        expect(tdsRateOnPanChange(INDIVIDUAL, COMPANY, 2, DEFAULT_TDS_RATE)).toBeNull();
    });
});

describe("fallbackTdsRate", () => {
    it("is the saved rate of a vendor saved with a company PAN", () => {
        expect(fallbackTdsRate(COMPANY, 3)).toBe(3);
        expect(fallbackTdsRate(COMPANY, 0)).toBe(0);
    });

    it("is 2% for a vendor saved as an Individual / HUF, or with no readable rate", () => {
        expect(fallbackTdsRate(INDIVIDUAL, 1)).toBe(2);
        expect(fallbackTdsRate(COMPANY, null)).toBe(2);
    });
});

describe("tdsRateMismatch", () => {
    it("refuses any rate but 1% for an Individual or HUF", () => {
        expect(tdsRateMismatch(INDIVIDUAL, "2")).toBe("PAN 4th letter P (Individual): TDS must be 1%.");
        expect(tdsRateMismatch(HUF, 3)).toBe("PAN 4th letter H (HUF): TDS must be 1%.");
        expect(tdsRateMismatch(INDIVIDUAL, 0)).toBe("PAN 4th letter P (Individual): TDS must be 1%.");
    });

    it("lets a company take any rate", () => {
        for (const rate of [0, 1, 2, 3, 4, "2.5"]) {
            expect(tdsRateMismatch(COMPANY, rate)).toBeNull();
        }
    });

    it("passes 1%, a blank box and a PAN still being typed", () => {
        expect(tdsRateMismatch(INDIVIDUAL, 1)).toBeNull();
        expect(tdsRateMismatch(INDIVIDUAL, "")).toBeNull();
        expect(tdsRateMismatch("ABCPE", 2)).toBeNull();
        expect(tdsRateMismatch(undefined, 3)).toBeNull();
    });
});

describe("tdsRateChangeNote", () => {
    it("names the saved and the new rate", () => {
        expect(tdsRateChangeNote(2, 1)).toBe("Saved rate is 2%; saving changes it to 1%.");
        expect(tdsRateChangeNote(2, "3")).toBe("Saved rate is 2%; saving changes it to 3%.");
    });

    it("says nothing for an unchanged, blank or unreadable rate", () => {
        expect(tdsRateChangeNote(1, "1")).toBeNull();
        expect(tdsRateChangeNote(1, "")).toBeNull();
        expect(tdsRateChangeNote(undefined, 1)).toBeNull();
        expect(tdsRateChangeNote(1, "abc")).toBeNull();
    });
});

describe("tdsRateHint", () => {
    it("states the rule until a whole PAN is typed", () => {
        expect(tdsRateHint(undefined)).toEqual({
            text: "Set from the PAN: always 1% for an Individual or HUF (4th letter P or H); 2% by default for everyone else.",
            tone: "info",
        });
        expect(tdsRateHint("ABCPE").tone).toBe("info");
    });

    // Owner, 2026-10-16: users must see that the PAN fixed the rate at 1%.
    it("shows the yellow notice for an Individual or HUF PAN", () => {
        expect(tdsRateHint("abcpe1234f")).toEqual({
            text: "TDS set to 1% — PAN 4th letter P (Individual). Individual and HUF vendors are always deducted at 1%.",
            tone: "fixed-1",
        });
        expect(tdsRateHint(HUF).tone).toBe("fixed-1");
    });

    it("tells a company the 2% is a default it can change", () => {
        expect(tdsRateHint(COMPANY)).toEqual({
            text: "PAN 4th letter C (not an Individual or HUF): 2% by default; you can change it.",
            tone: "info",
        });
    });
});
