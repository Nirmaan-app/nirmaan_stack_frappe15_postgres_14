/**
 * A vendor's bank account is its Payee (#1428, spec #1420, ADR-0033). Every screen that shows or
 * checks a vendor's bank details reads it here: the hover card, the detail popover, the
 * payment-request gate, the bank file and the vendor list. None reads the old `Vendors` bank fields.
 *
 * Server: `api/payees/vendor_accounts` over `services/payees/vendor_account`. Anyone who may read
 * Vendors may read a vendor's account; the Payee doctype itself stays Accounts / Procurement only.
 */

import { useCallback } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import type { Payee } from "@/types/NirmaanStack/Payee";

const VENDOR_ACCOUNTS_API = "nirmaan_stack.api.payees.vendor_accounts";
export const VENDOR_PAYEE_ACCOUNTS_API = `${VENDOR_ACCOUNTS_API}.get_vendor_payee_accounts`;
/** The vendor list, each row with its Payee's columns (`payee_account_number`, …). */
export const VENDOR_LIST_API = `${VENDOR_ACCOUNTS_API}.get_vendor_list`;

/** What a screen shows of a vendor's Payee. */
export type VendorPayeeAccount = Pick<
    Payee,
    "account_name" | "account_number" | "ifsc" | "bank_name" | "bank_branch" | "status"
> & { payee: string };

/** `{vendor: account}`; a vendor with no Payee is left out. */
export type VendorPayeeAccounts = Record<string, VendorPayeeAccount>;

/** SWR key of one vendor's account. Revalidate it after changing which Payee the vendor links to. */
export const vendorPayeeAccountKey = (vendor: string) => `vendor-payee-account:${vendor}`;

/**
 * One vendor's Payee: `undefined` while loading, when not asked or when the read failed; `null`
 * when the vendor has no Payee. `enabled: false` asks nothing (a popover that is still closed).
 */
export function useVendorPayeeAccount(vendor: string | undefined, enabled = true) {
    const ask = !!vendor && enabled;
    const { data, isLoading, error } = useFrappeGetCall<{ message: VendorPayeeAccounts }>(
        VENDOR_PAYEE_ACCOUNTS_API,
        { vendors: JSON.stringify([vendor]) },
        ask ? vendorPayeeAccountKey(vendor) : null,
    );
    const account = data && vendor ? (data.message[vendor] ?? null) : undefined;
    return { account, isLoading: ask && isLoading, error };
}

/**
 * The payment-request gate: a PO or Work Order payment ends as a row in the ICICI / Cashfree bank
 * file, which is paid into the vendor's Payee. A request for a vendor with no Payee only defers the
 * failure to the accountant, so it is refused at the source, with the remedy in the message.
 *
 * `missingPayee` is true only once the vendor is known to have no Payee. While the read is in flight
 * (or failed) the request goes through: a slow network must not become a hard stop with a wrong reason.
 */
export function useVendorPayeeGate(vendor: string | undefined, vendorLabel?: string) {
    const { account } = useVendorPayeeAccount(vendor);
    const missingPayee = account === null;
    const showMissingPayeeToast = useCallback(() => {
        toast({
            title: "Bank details missing",
            description: `${vendorLabel || "This vendor"} has no Payee (bank account). Add the vendor's bank account on the vendor page to request the payment.`,
            variant: "destructive",
        });
    }, [vendorLabel]);
    return { missingPayee, showMissingPayeeToast };
}
