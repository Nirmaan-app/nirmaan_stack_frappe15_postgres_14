import * as z from "zod";
import { GST_REGEX, PAN_REGEX } from "@/constants/vendorFormRegex";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { findVendorByGst } from "./vendorDuplicates";

/**
 * GST / PAN rules shared by the new-vendor and edit-vendor forms.
 *
 * `vendor_gst` and `vendor_pan` are two separate, typed fields:
 *   - PAN is required for EVERY vendor.
 *   - GST is required for Material and Material & Service vendors, optional for Service.
 *
 * A duplicate GST BLOCKS. A duplicate PAN never does (owner call) — one company holds a
 * GSTIN per state under a single PAN — so the forms only warn, via findVendorsByPan.
 * The PAN is not cross-checked against the GST number either (owner call).
 */
export const vendorTaxIdSchemas = (existingVendors: Vendors[] | undefined, gstOptional: boolean) => {
    const gstSchema = z
        .string({ required_error: "Vendor GST is required" })
        .regex(GST_REGEX, { message: "Invalid GST format. Example: 22AAAAA0000A1Z5" })
        .refine((value) => !findVendorByGst(existingVendors, value), (value) => {
            const owner = findVendorByGst(existingVendors, value);
            return {
                message: owner
                    ? `This GST is already registered to ${owner.vendor_name || owner.name}.`
                    : "This GST is already registered to another vendor.",
            };
        });

    const panSchema = z
        .string({ required_error: "Vendor PAN is required" })
        .regex(PAN_REGEX, { message: "Invalid PAN format. Example: ABCDE1234F" });

    return {
        vendor_gst: gstOptional ? gstSchema.optional() : gstSchema,
        vendor_pan: panSchema,
    };
};
