/**
 * An Income Tax PAN: the one rule, for a vendor's PAN and a request form's PAN answer (spec #1522, #1524).
 *
 * Twin of `services/vendor_tds.clean_pan` / `is_valid_pan`. Pure. Read by the vendor forms
 * (`pages/vendors/utils/vendorTaxIds`) and by the Expense Request form (`utils/expenseFormat`,
 * `FormatFieldsRenderer`), so neither reaches into the other's folder.
 */
import { PAN_REGEX } from "@/constants/vendorFormRegex";

/** A PAN as stored: trimmed and uppercased (`vendor_tds.clean_pan`). */
export const cleanPan = (pan: unknown): string => String(pan ?? "").trim().toUpperCase();

/** True for a PAN shaped like ABCPK1234D, in any case (`vendor_tds.is_valid_pan`). */
export const isValidPan = (pan: unknown): boolean => PAN_REGEX.test(cleanPan(pan));
