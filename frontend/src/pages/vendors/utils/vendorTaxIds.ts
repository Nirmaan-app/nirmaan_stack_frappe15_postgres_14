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

/**
 * A vendor's TDS rate, read off its PAN (Section 194C). "TDS" here is tax, not Technical Data Sheets.
 *
 * Twin of `services/vendor_tds.py`, which applies the same rule when a vendor is created or its PAN
 * or rate is edited; both read the shared `vendor_tds_cases.json`. The PAN's 4th letter is the holder
 * type (owner, 2026-10-16):
 *   - P (Individual) or H (HUF): always 1% — the form locks the field.
 *   - any other holder: 2% by default; the user may set any rate (1, 3, 4…) and it is kept.
 *   - blank or invalid PAN: the rate is kept as entered.
 */
export const INDIVIDUAL_HUF_TDS_RATE = 1;
export const DEFAULT_TDS_RATE = 2;
const INDIVIDUAL_HUF_HOLDERS: Record<string, string> = { P: "Individual", H: "HUF" };
// A rate as typed: a plain decimal. Hex, exponents, "%" and words are not rates (as on the server).
const DECIMAL_REGEX = /^\s*-?(\d+(\.\d*)?|\.\d+)\s*$/;

const cleanPan = (pan: unknown) => String(pan ?? "").trim().toUpperCase();

/** True for a valid PAN whose 4th letter is P (Individual) or H (HUF): its rate is always 1%. */
export const isIndividualHufPan = (pan: unknown): boolean => {
    const clean = cleanPan(pan);
    return PAN_REGEX.test(clean) && clean[3] in INDIVIDUAL_HUF_HOLDERS;
};

/** True for a number or a plain decimal string; blank, `true`, "2%" and "abc" are not rates. */
export const isReadableTdsRate = (rate: unknown): boolean =>
    (typeof rate === "number" && Number.isFinite(rate)) || (typeof rate === "string" && DECIMAL_REGEX.test(rate));

/** The rate a vendor save stores: 1% for an Individual / HUF, the 2% default for a valid PAN with no readable rate, else as entered. */
export const tdsRateToStore = <T>(pan: unknown, rate: T): T | number => {
    if (isIndividualHufPan(pan)) return INDIVIDUAL_HUF_TDS_RATE;
    if (PAN_REGEX.test(cleanPan(pan)) && !isReadableTdsRate(rate)) return DEFAULT_TDS_RATE;
    return rate;
};

/** "PAN 4th letter P (Individual)" — the reason a PAN gets its rate, for the form's messages. */
const panHolderLabel = (pan: unknown) => {
    const letter = cleanPan(pan)[3];
    return `PAN 4th letter ${letter} (${INDIVIDUAL_HUF_HOLDERS[letter] ?? "not an Individual or HUF"})`;
};

/**
 * The line under the TDS field. `fixed-1` is the one users must not miss (owner, 2026-10-16): the
 * PAN fixes the rate at 1%, so it shows as a yellow notice.
 */
export type TdsRateHint = { text: string; tone: "info" | "fixed-1" };

export const tdsRateHint = (pan: unknown): TdsRateHint => {
    if (!PAN_REGEX.test(cleanPan(pan))) {
        return {
            text: "Set from the PAN: always 1% for an Individual or HUF (4th letter P or H); 2% by default for everyone else.",
            tone: "info",
        };
    }
    if (isIndividualHufPan(pan)) {
        return {
            text: `TDS set to 1% — ${panHolderLabel(pan)}. Individual and HUF vendors are always deducted at 1%.`,
            tone: "fixed-1",
        };
    }
    return { text: `${panHolderLabel(pan)}: 2% by default; you can change it.`, tone: "info" };
};

/** The form's check: an Individual / HUF PAN with a rate other than 1%. `null` when the rate is fine. */
export const tdsRateMismatch = (pan: unknown, rate: unknown): string | null =>
    isIndividualHufPan(pan) && isReadableTdsRate(rate) && Number(rate) !== INDIVIDUAL_HUF_TDS_RATE
        ? `${panHolderLabel(pan)}: TDS must be 1%.`
        : null;

/**
 * zod `superRefine` for both vendor forms: an Individual / HUF PAN with a rate other than 1% fails
 * on the TDS field. The field is locked at 1% for such a PAN, so this is the backstop.
 */
export const refineTdsRateAgainstPan = (
    values: { vendor_pan?: string; tds_deduction_percentage?: unknown },
    ctx: z.RefinementCtx
) => {
    const mismatch = tdsRateMismatch(values.vendor_pan, values.tds_deduction_percentage);
    if (mismatch) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tds_deduction_percentage"], message: mismatch });
    }
};

/**
 * The rate to fill in when the PAN changes from `prevPan` to `pan`, or `null` to leave the field.
 * An Individual / HUF PAN sets 1%. Moving off one puts back `fallbackRate`: 2% on the new-vendor
 * form, `fallbackTdsRate` on the edit form.
 */
export const tdsRateOnPanChange = (
    prevPan: unknown,
    pan: unknown,
    rate: unknown,
    fallbackRate: number
): number | null => {
    let target: number | null = null;
    if (isIndividualHufPan(pan)) target = INDIVIDUAL_HUF_TDS_RATE;
    else if (isIndividualHufPan(prevPan)) target = fallbackRate;
    if (target === null) return null;
    return isReadableTdsRate(rate) && Number(rate) === target ? null : target;
};

/** Edit form: the rate to put back when an Individual / HUF PAN is replaced — the saved rate when the saved PAN was not one, else 2%. */
export const fallbackTdsRate = (savedPan: unknown, savedRate: unknown): number =>
    !isIndividualHufPan(savedPan) && isReadableTdsRate(savedRate) ? Number(savedRate) : DEFAULT_TDS_RATE;

/** Edit form: "Saved rate is 2%; saving changes it to 1%." — `null` when the rate is unchanged or blank. */
export const tdsRateChangeNote = (saved: unknown, current: unknown): string | null => {
    if (!isReadableTdsRate(saved) || !isReadableTdsRate(current)) return null;
    const before = Number(saved);
    const after = Number(current);
    if (before === after) return null;
    return `Saved rate is ${before}%; saving changes it to ${after}%.`;
};
