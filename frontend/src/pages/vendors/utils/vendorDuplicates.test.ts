import { describe, expect, it } from "vitest";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { findVendorByGst, findVendorsByPan, vendorNamesLabel } from "./vendorDuplicates";

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

// Real production shape: one company registered once per state.
const ductofab = [
    vendor({ name: "V1", vendor_name: "D.S. Ductofab (Bengaluru)", vendor_gst: "29AAA0000A1Z5" }),
    vendor({ name: "V2", vendor_name: "D.S. Ductofab (Rohtak)", vendor_gst: "06AAA0000A1Z5" }),
    vendor({ name: "V3", vendor_name: "Unrelated Traders", vendor_gst: "27BBB0000B1Z5" }),
];

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

describe("findVendorsByPan", () => {
    // Real production shape: one GST vendor per state sharing a PAN, plus the same
    // business registered again as a PAN-only service vendor.
    const panVendors = [
        vendor({ name: "G1", vendor_gst: "29APNPR5521H1ZG", vendor_pan: "APNPR5521H" }),
        vendor({ name: "G2", vendor_gst: "36APNPR5521H1ZX", vendor_pan: "APNPR5521H" }),
        vendor({ name: "P1", vendor_gst: "", vendor_pan: "APNPR5521H" }),
        vendor({ name: "P2", vendor_pan: "CZSPK2048F" }),
    ];

    it("returns every vendor holding the PAN, with or without GST", () => {
        expect(findVendorsByPan(panVendors, "APNPR5521H").map((v) => v.name)).toEqual(["G1", "G2", "P1"]);
    });

    it("returns nothing for an unused PAN or a blank value", () => {
        expect(findVendorsByPan(panVendors, "ZZZZZ9999Z")).toEqual([]);
        expect(findVendorsByPan(panVendors, "")).toEqual([]);
    });

    it("never matches a PAN prefix typed so far", () => {
        expect(findVendorsByPan(panVendors, "APNPR5521")).toEqual([]);
    });

    it("tolerates an unloaded vendor list", () => {
        expect(findVendorsByPan(undefined, "APNPR5521H")).toEqual([]);
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

    it("names a company once when several vendor records share its name", () => {
        const vaswani = "C P Vaswani Distribution and Allied Services LLP";
        expect(
            vendorNamesLabel([
                vendor({ name: "VEN-Material-0101", vendor_name: vaswani }),
                vendor({ name: "VEN-Material-0102", vendor_name: `${vaswani} ` }),
                vendor({ name: "VEN-Material-0103", vendor_name: vaswani.toUpperCase() }),
            ])
        ).toBe(vaswani);
    });

    it("sorts names A to Z", () => {
        expect(
            vendorNamesLabel([
                vendor({ name: "V3", vendor_name: "zeta Traders" }),
                vendor({ name: "V1", vendor_name: "Alpha Steel" }),
                vendor({ name: "V2", vendor_name: "Beta Cables" }),
            ])
        ).toBe("Alpha Steel, Beta Cables and zeta Traders");
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
