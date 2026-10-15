/**
 * The wording of the vendor screens' Payee step (spec #1420, approved mockup screens 5 and 6): the
 * "Payees that look like this vendor" cards and the "Use an existing payee" confirmation. Pure, so
 * it tests without React. The ranking itself is the server's (`services/payees/matching.py`).
 */

import { PAYEE_MATCH, type PayeeWithLinks, type PayeeMatch, type PayeeSuggestion } from "@/types/NirmaanStack/Payee";

import {
    bankLine,
    cleanAccountNumber,
    cleanIfsc,
    linkedVendorsLabel,
    NO_VENDOR_LINKED,
    newPayeeProblem,
    type PayeeFormValues,
} from "./payeeForm";

export const MATCH_LABEL: Record<PayeeMatch, string> = {
    [PAYEE_MATCH.STRONG]: "Strong match",
    [PAYEE_MATCH.NAME_ONLY]: "Name only",
};

/** "PYE-0412, A/c 50200061234567, HDFC0000195, HDFC Bank, Rohtak". */
export const accountLine = (p: Pick<PayeeWithLinks, "name" | "account_number" | "ifsc" | "bank_name" | "bank_branch">): string => {
    return [p.name, `A/c ${p.account_number}`, p.ifsc, bankLine(p)].filter(Boolean).join(", ");
};

const MAX_NAMED = 5;

/** "A, B, C and 2 more" past `MAX_NAMED`. */
const namedList = (names: string[]): string =>
    names.length > MAX_NAMED
        ? `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more`
        : names.join(", ");

/**
 * A suggestion card's second line: whether the PAN agrees with `vendorPan` (the new vendor's, as
 * typed; nothing is said until one is), then the vendors linked to the Payee, naming their places
 * ("Linked to 3 vendors: Rohtak, Gujarat, Bengaluru."). "Linked", not "paid": a Payee may serve
 * vendors that were never paid.
 */
export const suggestionLinkLine = (s: PayeeSuggestion, vendorPan: string | undefined): string => {
    const pan =
        s.match === PAYEE_MATCH.STRONG
            ? "Same PAN as its linked vendors."
            : vendorPan?.trim() && s.linked_vendors.some((v) => v.vendor_pan)
              ? "Different PAN."
              : "";
    const label = linkedVendorsLabel(s.vendors);
    let linked = NO_VENDOR_LINKED;
    if (label) {
        const places = [...new Set(s.linked_vendors.map((v) => v.vendor_city || v.vendor_name || v.name))];
        linked = `Linked to ${label}${places.length ? `: ${namedList(places)}` : ""}.`;
    }
    return [pan, linked].filter(Boolean).join(" ");
};

/** "Where do we pay this vendor?": a Payee already on record, or new bank details. */
export const VENDOR_PAYEE_MODE = {
    EXISTING: "existing",
    NEW: "new",
} as const;

export type VendorPayeeMode = (typeof VENDOR_PAYEE_MODE)[keyof typeof VENDOR_PAYEE_MODE];

/** What the vendor endpoints take for the vendor's Payee: one or the other, never both. */
export type VendorPayeeAnswer =
    | { payee: string }
    | { bank: { account_name: string; account_number: string; ifsc: string } };

/** The vendor's Payee as the server takes it, from the answer on screen. */
export const vendorPayeeAnswer = ({
    mode,
    chosen,
    form,
}: {
    mode: VendorPayeeMode;
    chosen: string | null;
    form: PayeeFormValues;
}): VendorPayeeAnswer =>
    mode === VENDOR_PAYEE_MODE.EXISTING && chosen
        ? { payee: chosen }
        : {
              bank: {
                  account_name: form.account_name.trim(),
                  account_number: cleanAccountNumber(form.account_number),
                  ifsc: cleanIfsc(form.ifsc),
              },
          };

/**
 * Why the vendor can't be saved with this answer yet, or null. `formProblem` is the bank form's own
 * (`payeeForm.payeeFormProblem`); `duplicate` is whether a Payee already holds the typed account.
 */
export const vendorPayeeProblem = ({
    mode,
    chosen,
    formProblem,
    duplicate,
    lookingUp,
}: {
    mode: VendorPayeeMode;
    chosen: string | null;
    formProblem: string | null;
    duplicate: boolean;
    lookingUp: boolean;
}): string | null => {
    if (mode === VENDOR_PAYEE_MODE.EXISTING) {
        return chosen ? null : "Pick a payee from the matches, or enter new bank details.";
    }
    return newPayeeProblem({ formProblem, duplicate, lookingUp });
};
