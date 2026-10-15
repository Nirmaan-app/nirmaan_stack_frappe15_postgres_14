/**
 * Editing and deleting a Payee (#1435, spec #1420, ADR-0033 decision 4), pure so the rules test
 * without React. A Payee is an address book entry: when its holder moves banks it is edited in place,
 * and every vendor paid into it follows. Records already raised keep their own copy of the account.
 *
 * The server is the boundary (`services/payees/writer.edit_payee` / `delete_payee`): it refuses a
 * duplicate on edit and a delete while a vendor links. These rules shape the screen before it asks.
 */

import type { PayeeChange, PayeeSummary } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";

import { cleanIfsc, type PayeeFormValues } from "./payeeForm";

type PayeeAccount = Pick<PayeeSummary, "name" | "account_name" | "account_number" | "ifsc">;

/** A vendor paid into a Payee, as the warnings name it. */
export interface PayeeVendorName {
    name: string;
    vendor_name?: string | null;
}

const vendorLabel = (v: PayeeVendorName): string => (v.vendor_name ? `${v.vendor_name} (${v.name})` : v.name);

/**
 * The edit form, started from the Payee's own account: the number already in both boxes, so a holder
 * name fix needs no retyping. Changing the number empties the match: the second box is typed again.
 * `holderName` replaces the saved holder name (the rename prompt's new vendor name).
 */
export const payeeEditForm = (payee: PayeeAccount, holderName?: string): PayeeFormValues => ({
    account_name: holderName ?? payee.account_name,
    account_number: payee.account_number,
    confirm_account_number: payee.account_number,
    ifsc: payee.ifsc,
});

/**
 * True when an edit keeps the Payee's own IFSC: its bank and branch stand as saved and the server
 * looks nothing up, so the form needs no lookup to save (a Payee moved from a vendor may have no bank
 * name on record).
 */
export const payeeEditKeepsIfsc = (payee: Pick<PayeeSummary, "ifsc"> | undefined, ifsc: string): boolean =>
    !!payee && cleanIfsc(ifsc) === cleanIfsc(payee.ifsc);

/**
 * The warning shown before saving an edit to a Payee that serves more than one vendor, naming every
 * vendor the edit changes; null when one vendor or none is paid into it.
 */
export const sharedPayeeWarning = (vendors: PayeeVendorName[]): string | null =>
    vendors.length > 1
        ? `${vendors.length} vendors are paid into this account. Saving changes it for all of them: ` +
          `${vendors.map(vendorLabel).join(", ")}.`
        : null;

/** Why a Payee can't be deleted (vendors are paid into it, every one named), or null when it can. */
export const payeeDeleteBlock = (vendors: PayeeVendorName[]): string | null => {
    if (!vendors.length) return null;
    const one = vendors.length === 1;
    return (
        `This payee can't be deleted: ${vendors.length} vendor${one ? " is" : "s are"} paid into it ` +
        `(${vendors.map(vendorLabel).join(", ")}). Point ${one ? "it" : "them"} at another payee first.`
    );
};

/** "15-Oct-2026 by Riya Sharma", or "Never". */
export const lastChangeLine = (change: PayeeChange | null | undefined): string =>
    change ? `${formatDate(change.on)} by ${change.by}` : "Never";
