/**
 * What the vendor screens' Payee step reads from the server (#1425, spec #1420):
 * `api/payees/vendor_payee`. The new-vendor form and the vendor page's Change account (#1426) use it;
 * one vendor's account is `vendorPayeeAccount.useVendorAccount`.
 */

import { useEffect, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { PayeeSuggestion, PayeeWithLinks } from "@/types/NirmaanStack/Payee";

const VENDOR_PAYEE_API = "nirmaan_stack.api.payees.vendor_payee";
export const SUGGEST_VENDOR_PAYEES_API = `${VENDOR_PAYEE_API}.suggest_vendor_payees`;
/** One Payee with its links (`PayeeWithLinks`); the endpoint keeps its first name. */
export const GET_PAYEE_WITH_LINKS_API = `${VENDOR_PAYEE_API}.get_payee_choice`;
export const CHECK_VENDOR_PAYEE_API = `${VENDOR_PAYEE_API}.check_vendor_payee`;
export const CHANGE_VENDOR_PAYEE_API = `${VENDOR_PAYEE_API}.change_vendor_payee`;

const SUGGEST_DEBOUNCE_MS = 400;

/** `value`, once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return settled;
}

/**
 * "Payees that look like this vendor", for the name and PAN typed so far (asked once typing
 * pauses). Nothing is asked until a name of three letters or a PAN is typed.
 */
export function useVendorPayeeSuggestions(vendorName: string | undefined, vendorPan: string | undefined) {
    const name = useSettled((vendorName ?? "").trim(), SUGGEST_DEBOUNCE_MS);
    const pan = useSettled((vendorPan ?? "").trim().toUpperCase(), SUGGEST_DEBOUNCE_MS);
    const ask = name.length >= 3 || pan.length > 0;
    const { data, isLoading, error } = useFrappeGetCall<{ message: { suggestions: PayeeSuggestion[] } }>(
        SUGGEST_VENDOR_PAYEES_API,
        { vendor_name: name, vendor_pan: pan },
        ask ? `vendor-payee-suggestions:${name}|${pan}` : null,
    );
    return { asked: ask, suggestions: data?.message.suggestions ?? [], isLoading: ask && isLoading, error };
}

/** One Payee with every linked vendor and expense and its last payment, for the confirmation. */
export function usePayeeWithLinks(payee: string | null) {
    const { data, isLoading, error } = useFrappeGetCall<{ message: PayeeWithLinks }>(
        GET_PAYEE_WITH_LINKS_API,
        { payee },
        payee ? `payee-with-links:${payee}` : null,
    );
    return { choice: data?.message ?? null, isLoading, error };
}
