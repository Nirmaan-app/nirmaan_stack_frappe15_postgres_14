import { describe, expect, it } from "vitest";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { vendorTaxIdSchemas } from "./vendorTaxIds";

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
