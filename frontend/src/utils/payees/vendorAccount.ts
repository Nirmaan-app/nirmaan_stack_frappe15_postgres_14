/**
 * The vendor page's account rules (#1426, spec #1420, approved mockup screens 7 and 8): the Account
 * Details card's wording and when renaming a vendor asks what happens to its bank account. Pure, so
 * they test without React. The card's data comes from `api/payees/vendor_payee.get_vendor_account`.
 */

/** The card's line under "Paid into payee PYE-0412.": how many other vendors share the account. */
export const sharedAccountLine = (otherVendors: number): string =>
    otherVendors === 0
        ? "No other vendor is paid into the same account."
        : otherVendors === 1
          ? "1 other vendor is paid into the same account."
          : `${otherVendors} other vendors are paid into the same account.`;

/** The card for a vendor with no Payee. */
export const NO_ACCOUNT_LINE =
    "No bank account yet. Payments for this vendor's POs and Work Orders can't be requested until one is added.";

/** The rename prompt's choices ("Decide later" closes it). */
export const RENAME_CHOICE = {
    KEEP: "keep",
    HOLDER_NAME: "holder_name",
    NEW_BANK: "new_bank",
} as const;

export type RenameChoice = (typeof RENAME_CHOICE)[keyof typeof RENAME_CHOICE];

/** The help under "Update the holder name": who else shows the new name, and who may do it. */
export const holderNameChoiceHelp = (otherVendors: number): string => {
    const sharing =
        otherVendors === 0
            ? ""
            : otherVendors === 1
              ? " 1 other vendor shares this account and will show the new name too."
              : ` ${otherVendors} other vendors share this account and will show the new name too.`;
    return `The bank now has the new name on the same account.${sharing} Only Accounts and Admins can do this.`;
};

const sameName = (a: string, b: string): boolean =>
    a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Whether saving a vendor asks what happens to its bank account: the vendor was renamed, it has a
 * Payee (`holder` is that Payee's holder name, null without one), and the new name is not already
 * the holder name.
 */
export const renameNeedsPrompt = ({
    before,
    after,
    holder,
}: {
    before: string;
    after: string;
    holder: string | null;
}): boolean => holder !== null && !sameName(before, after) && !sameName(after, holder);

/** Why a PO / Work Order payment can't be requested yet because of the vendor's bank account, or null. */
export interface VendorPayeeGateProblem {
    title: string;
    description: string;
}

/**
 * The payment-request gate's verdict. `account` is the vendor's Payee: `undefined` while it loads (or
 * when the read failed: `failed`), `null` when the vendor has none. A request goes through only once
 * the vendor is known to have one, so a slow or failed read never lets a request out unchecked.
 */
export const vendorPayeeGateProblem = ({
    vendorLabel,
    account,
    failed,
}: {
    vendorLabel?: string | null;
    account: object | null | undefined;
    failed: boolean;
}): VendorPayeeGateProblem | null => {
    const vendor = vendorLabel || "This vendor";
    if (account) return null;
    if (account === null) {
        return {
            title: "Bank details missing",
            description: `${vendor} has no Payee (bank account). Add the vendor's bank account on the vendor page to request the payment.`,
        };
    }
    if (failed) {
        return {
            title: "Couldn't check the bank account",
            description: `Couldn't read ${vendorLabel || "the vendor"}'s bank account, so the payment can't be requested yet. Check your connection and try again.`,
        };
    }
    return {
        title: "Checking the bank account",
        description: `${vendor}'s bank account is still loading. Try again in a moment.`,
    };
};
