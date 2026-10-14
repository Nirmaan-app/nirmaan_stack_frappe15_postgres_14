/**
 * The wording of the vendor screens' Payee step (spec #1420, approved mockup screens 5 and 6): the
 * "Payees that look like this vendor" cards and the "Use an existing payee" confirmation. Pure, so
 * it tests without React. The ranking itself is the server's (`services/payees/matching.py`).
 */

import { format, parseISO } from "date-fns";

import { PAYEE_MATCH, type PayeeChoice, type PayeeMatch, type PayeeSuggestion } from "@/types/NirmaanStack/Payee";

import { cleanAccountNumber, cleanIfsc, linkedToLabels, type PayeeFormValues } from "./payeeForm";

export const MATCH_LABEL: Record<PayeeMatch, string> = {
    [PAYEE_MATCH.STRONG]: "Strong match",
    [PAYEE_MATCH.NAME_ONLY]: "Name only",
};

/** "PYE-0412, A/c 50200061234567, HDFC0000195, HDFC Bank Rohtak". */
export const accountLine = (p: Pick<PayeeChoice, "name" | "account_number" | "ifsc" | "bank_name" | "bank_branch">): string => {
    const bank = [p.bank_name, p.bank_branch].filter(Boolean).join(" ");
    return [p.name, `A/c ${p.account_number}`, p.ifsc, bank].filter(Boolean).join(", ");
};

const MAX_NAMED = 5;

/** "A, B, C and 2 more" past `MAX_NAMED`. */
const namedList = (names: string[]): string =>
    names.length > MAX_NAMED
        ? `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more`
        : names.join(", ");

/**
 * A suggestion card's second line: whether the PAN agrees, then what the Payee is linked to, naming
 * its vendors' places when it serves vendors only ("Paid by 3 vendors: Rohtak, Gujarat, Bengaluru.").
 */
export const suggestionLinkLine = (s: PayeeSuggestion): string => {
    const pan =
        s.match === PAYEE_MATCH.STRONG
            ? "Same PAN as its linked vendors."
            : s.linked_vendors.some((v) => v.vendor_pan)
              ? "Different PAN."
              : "";
    const links = linkedToLabels(s);
    let linked = "Not linked to anything yet.";
    if (links.length && !s.expenses) {
        const places = [...new Set(s.linked_vendors.map((v) => v.vendor_city || v.vendor_name || v.name))];
        linked = `Paid by ${links[0]}${places.length ? `: ${namedList(places)}` : ""}.`;
    } else if (links.length) {
        linked = `Paid by ${links.join(" and ")}.`;
    }
    return [pan, linked].filter(Boolean).join(" ");
};

/** "Last paid 08-Oct-2026, on PO/005/00107/26-27." */
export const lastPaidLine = (c: Pick<PayeeChoice, "last_payment">): string =>
    c.last_payment
        ? `Last paid ${format(parseISO(c.last_payment.date), "dd-MMM-yyyy")}, on ${c.last_payment.document}.`
        : "Never paid yet.";

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
    if (lookingUp) return "Wait for the IFSC lookup.";
    if (formProblem) return formProblem;
    if (duplicate) return "This account is already a payee. Use that payee instead of adding a new one.";
    return null;
};

/** "2 (PE-2026-00712, NPE-2026-00093)", or null when no expense names the Payee. */
export const expensesLine = (c: Pick<PayeeChoice, "linked_expenses">): string | null =>
    c.linked_expenses.length
        ? `${c.linked_expenses.length} (${namedList(c.linked_expenses.map((e) => e.name))})`
        : null;
