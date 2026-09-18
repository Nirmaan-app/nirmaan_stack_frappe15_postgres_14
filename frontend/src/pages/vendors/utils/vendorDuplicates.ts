import { Vendors } from "@/types/NirmaanStack/Vendors";

/**
 * Duplicate lookups shared by the new-vendor and edit-vendor forms.
 *
 * Both GST and the account number are HARD duplicates — a second vendor may not
 * be pointed at either value.
 *
 * The account-number rule carries ONE exemption, and it is load-bearing: a vendor
 * may keep the number it already holds. NINETEEN existing vendors legitimately
 * share eight account numbers (one company registered per state under separate
 * GSTs, banking in one place). Without the exemption the rule would fire against
 * their own prefilled value on the edit form and make all nineteen unsavable —
 * blocking an unrelated phone-number change on a record nobody was duplicating.
 *
 * Comparison is NORMALISED (spaces and dashes stripped) and that is not cosmetic:
 * two of those nineteen are only reachable that way — "080902 00000205" carries an
 * interior space and "50200023578202 " a trailing one. An exact-match rule would
 * call them distinct, miss the duplicate on create, and — worse — fail the
 * exemption on edit, since a record's own stored value would not match itself.
 */

/** Account numbers are typed with stray spaces / dashes; compare on digits only. */
export const normalizeAccountNumber = (value?: string | number | null): string =>
    String(value ?? "").replace(/[\s-]/g, "");

/** Minimum length before the duplicate notice appears — avoids warning mid-typing. */
export const ACCOUNT_NUMBER_MATCH_MIN_LENGTH = 9;

/**
 * Vendors already holding this account number. Returns [] until enough digits are
 * typed, so the notice does not flash on a prefix of an unrelated account.
 */
export const findVendorsByAccountNumber = (
    existingVendors: Vendors[] | undefined,
    accountNumber?: string | number | null
): Vendors[] => {
    const target = normalizeAccountNumber(accountNumber);
    if (target.length < ACCOUNT_NUMBER_MATCH_MIN_LENGTH) return [];
    return (existingVendors ?? []).filter(
        (vendor) => normalizeAccountNumber(vendor.account_number) === target
    );
};

/** The vendor already holding this GST, if any. */
export const findVendorByGst = (
    existingVendors: Vendors[] | undefined,
    gst?: string | null
): Vendors | undefined => {
    if (!gst) return undefined;
    return (existingVendors ?? []).find((vendor) => vendor.vendor_gst === gst);
};

/**
 * Every other vendor already holding this PAN. A WARNING only, never a block: one company
 * legitimately appears under several GSTINs (one per state) carrying the same PAN.
 */
export const findVendorsByPan = (
    existingVendors: Vendors[] | undefined,
    pan?: string | null
): Vendors[] => {
    if (!pan) return [];
    return (existingVendors ?? []).filter((vendor) => vendor.vendor_pan === pan);
};

/**
 * "A", "A and B", "A, B and C" — for naming the matched vendors in a message.
 *
 * Names are DEDUPED and sorted A→Z. One company registered per state is several vendor
 * records under the SAME name, so without the dedupe a PAN match read
 * "X LLP and X LLP". Comparison ignores case and extra spaces; the first spelling wins.
 */
export const vendorNamesLabel = (vendors: Vendors[]): string => {
    const byKey = new Map<string, string>();
    for (const vendor of vendors) {
        const label = (vendor.vendor_name || vendor.name || "").trim();
        const key = label.replace(/\s+/g, " ").toLowerCase();
        if (label && !byKey.has(key)) byKey.set(key, label);
    }
    const names = [...byKey.values()].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/**
 * The blocking rule for account numbers: returns an error message when `value`
 * belongs to another vendor, or null when it is free to use.
 *
 * `originalValue` is the number the record already holds (edit form). A value
 * equal to it is always allowed — see the exemption note above. On the create
 * form there is no original, so every match blocks.
 */
export const accountNumberDuplicateMessage = (
    existingVendors: Vendors[] | undefined,
    value?: string | number | null,
    originalValue?: string | number | null
): string | null => {
    const target = normalizeAccountNumber(value);
    if (!target) return null;
    if (originalValue != null && target === normalizeAccountNumber(originalValue)) return null;
    const owners = findVendorsByAccountNumber(existingVendors, value);
    if (owners.length === 0) return null;
    return `This account number is already registered to ${vendorNamesLabel(owners)}.`;
};
