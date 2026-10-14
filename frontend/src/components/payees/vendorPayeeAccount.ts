/**
 * A vendor's bank account is its Payee (#1428, #1426, spec #1420, ADR-0033). Every screen that shows
 * or checks ONE vendor's bank details reads it here, under one SWR key (`vendorAccountKey`): the
 * vendor page's Account Details card, the rename prompt, the hover card, the detail popover and the
 * payment-request gate. Revalidating that key after Change account updates all of them. Many vendors
 * at once (the bank file, the vendor list) go through `VENDOR_PAYEE_ACCOUNTS_API` / `VENDOR_LIST_API`.
 *
 * Server: `api/payees/vendor_payee.get_vendor_account` and `api/payees/vendor_accounts`, over
 * `services/payees/vendor_account`. Anyone who may read Vendors may read a vendor's account; the Payee
 * doctype itself stays Accounts / Procurement only.
 */

import { useCallback } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import type { Payee, PayeeSummary } from "@/types/NirmaanStack/Payee";
import { vendorPayeeGateProblem } from "@/utils/payees/vendorAccount";

const VENDOR_ACCOUNTS_API = "nirmaan_stack.api.payees.vendor_accounts";
export const VENDOR_PAYEE_ACCOUNTS_API = `${VENDOR_ACCOUNTS_API}.get_vendor_payee_accounts`;
/** The vendor list, each row with its Payee's columns (`payee_account_number`, …). */
export const VENDOR_LIST_API = `${VENDOR_ACCOUNTS_API}.get_vendor_list`;
/** One vendor's account: its Payee's summary and how many other vendors share it. */
export const GET_VENDOR_ACCOUNT_API = "nirmaan_stack.api.payees.vendor_payee.get_vendor_account";

/** What a screen shows of a vendor's Payee. */
export type VendorPayeeAccount = Pick<
    Payee,
    "account_name" | "account_number" | "ifsc" | "bank_name" | "bank_branch" | "status"
> & { payee: string };

/** `{vendor: account}`; a vendor with no Payee is left out. */
export type VendorPayeeAccounts = Record<string, VendorPayeeAccount>;

/** One vendor's account (`get_vendor_account`): its Payee and who else shares it. */
export interface VendorAccount {
    payee: PayeeSummary | null;
    /** Other vendors paid into the same Payee. */
    other_vendors: number;
}

/** THE SWR key of one vendor's account. Revalidate it after changing which Payee the vendor links to. */
export const vendorAccountKey = (vendor: string) => `vendor-account:${vendor}`;

/**
 * One vendor's account. `account` is `undefined` while loading, when not asked or when the read
 * failed (then `error` is set). `enabled: false` asks nothing (a popover that is still closed).
 * `refresh` after Change account or a holder-name edit: every screen reading this vendor follows.
 */
export function useVendorAccount(vendor: string | undefined, enabled = true) {
    const ask = !!vendor && enabled;
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: VendorAccount }>(
        GET_VENDOR_ACCOUNT_API,
        { vendor },
        ask ? vendorAccountKey(vendor) : null,
    );
    const refresh = useCallback(async () => {
        await mutate();
    }, [mutate]);
    return { account: data?.message, isLoading: ask && isLoading, error, refresh };
}

/**
 * One vendor's Payee as the screens show it: `undefined` while loading, when not asked or when the
 * read failed; `null` when the vendor has no Payee.
 */
export function useVendorPayeeAccount(vendor: string | undefined, enabled = true) {
    const { account, isLoading, error } = useVendorAccount(vendor, enabled);
    const payee = account?.payee;
    const payeeAccount: VendorPayeeAccount | null | undefined =
        account === undefined
            ? undefined
            : payee
              ? {
                    payee: payee.name,
                    account_name: payee.account_name,
                    account_number: payee.account_number,
                    ifsc: payee.ifsc,
                    bank_name: payee.bank_name ?? undefined,
                    bank_branch: payee.bank_branch ?? undefined,
                    status: payee.status,
                }
              : null;
    return { account: payeeAccount, isLoading, error };
}

/**
 * The payment-request gate: a PO or Work Order payment ends as a row in the ICICI / Cashfree bank
 * file, which is paid into the vendor's Payee. A request for a vendor with no Payee only defers the
 * failure to the accountant, so it is refused at the source, with the remedy in the message.
 *
 * `payeeBlocked` stays true until the vendor is KNOWN to have a Payee: while the read is in flight
 * and when it failed too, each with its own reason (`utils/payees/vendorAccount.vendorPayeeGateProblem`).
 */
export function useVendorPayeeGate(vendor: string | undefined, vendorLabel?: string) {
    const { account, error } = useVendorPayeeAccount(vendor);
    const problem = vendorPayeeGateProblem({ vendorLabel, account, failed: !!error });
    const showPayeeBlockedToast = useCallback(() => {
        if (problem) toast({ ...problem, variant: "destructive" });
    }, [problem]);
    return { payeeBlocked: problem !== null, showPayeeBlockedToast };
}
