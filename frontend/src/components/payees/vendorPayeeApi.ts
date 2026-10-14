/**
 * What the vendor screens' Payee step reads from the server (#1425, spec #1420):
 * `api/payees/vendor_payee`. The new-vendor form and the vendor page's Account Details card
 * (#1426) use it.
 */

import { useCallback, useEffect, useState } from "react";
import { useFrappeGetCall, useSWRConfig } from "frappe-react-sdk";

import type { PayeeChoice, PayeeSuggestion, PayeeSummary } from "@/types/NirmaanStack/Payee";

import { vendorPayeeAccountKey } from "./vendorPayeeAccount";

const VENDOR_PAYEE_API = "nirmaan_stack.api.payees.vendor_payee";
export const SUGGEST_VENDOR_PAYEES_API = `${VENDOR_PAYEE_API}.suggest_vendor_payees`;
export const GET_PAYEE_CHOICE_API = `${VENDOR_PAYEE_API}.get_payee_choice`;
export const CHECK_VENDOR_PAYEE_API = `${VENDOR_PAYEE_API}.check_vendor_payee`;
export const GET_VENDOR_ACCOUNT_API = `${VENDOR_PAYEE_API}.get_vendor_account`;
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

/** The vendor page's Account Details card (`get_vendor_account`): its Payee and who else shares it. */
export interface VendorAccount {
    payee: PayeeSummary | null;
    /** Other vendors paid into the same Payee. */
    other_vendors: number;
}

/** The SWR key of a vendor's account: mutate it after Change account. */
export const vendorAccountKey = (vendor: string) => `vendor-account:${vendor}`;

/**
 * The Payee a vendor is paid into, for the Account Details card and the rename prompt. `refresh`
 * after Change account or a holder-name edit: it also revalidates the vendor's account as the other
 * screens read it (`vendorPayeeAccount.vendorPayeeAccountKey`, #1428).
 */
export function useVendorAccount(vendor: string | undefined) {
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: VendorAccount }>(
        GET_VENDOR_ACCOUNT_API,
        { vendor },
        vendor ? vendorAccountKey(vendor) : null,
    );
    const { mutate: mutateKey } = useSWRConfig();
    const refresh = useCallback(async () => {
        await Promise.all([mutate(), vendor ? mutateKey(vendorPayeeAccountKey(vendor)) : undefined]);
    }, [mutate, mutateKey, vendor]);
    return { account: data?.message ?? null, isLoading, error, refresh };
}

/** One Payee with every linked vendor and expense and its last payment, for the confirmation. */
export function usePayeeChoice(payee: string | null) {
    const { data, isLoading, error } = useFrappeGetCall<{ message: PayeeChoice }>(
        GET_PAYEE_CHOICE_API,
        { payee },
        payee ? `payee-choice:${payee}` : null,
    );
    return { choice: data?.message ?? null, isLoading, error };
}
