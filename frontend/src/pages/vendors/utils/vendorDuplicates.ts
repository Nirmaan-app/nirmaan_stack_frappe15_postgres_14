import { Vendors } from "@/types/NirmaanStack/Vendors";

/**
 * Duplicate lookups shared by the new-vendor and edit-vendor forms: GST is a HARD
 * duplicate (a second vendor may not hold it), PAN only a warning.
 *
 * Bank accounts are not checked here: a vendor's account is its Payee, and the server
 * refuses a duplicate Payee (ADR-0033).
 */

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
