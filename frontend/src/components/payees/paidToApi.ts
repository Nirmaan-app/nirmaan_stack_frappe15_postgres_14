/**
 * Paying a payment or an expense (spec #1420 tickets #1431, #1438, #1463): the endpoints of
 * `api/payees/paid_to.py` and what they return. Every row is paid into its own pay-to account; the
 * server's Payee module reads it (`services/payees/paid_to.py`).
 */

import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import type { NamedBy, PaidTo, SkippedPayment } from "@/utils/payees/paidTo";

import type { PayeeChoiceApis } from "./usePayeeChoice";

const API = "nirmaan_stack.api.payees.paid_to";
/** Who each `{doctype, name}` row is paid to, read now (Export for Payment). */
export const PAID_TO_API = `${API}.get_paid_to`;
/** Export for Payment and Mark as Paid: write the vendor's current account onto each PO / WO payment
 *  that switches to it (#1463). Takes `{payments}`, a `ShownSwitch` for every PO / WO payment being
 *  paid: the server decides again which switch, and refuses the whole call ("The vendor's account for
 *  <PO> changed again. Refresh and try again.") when that is not the switch the payer was shown.
 *  Returns a `TakeVendorAccountsAnswer`. */
export const TAKE_VENDOR_ACCOUNTS_API = `${API}.take_vendor_accounts`;
/** Record Payment's "Pay ₹X to" box, for an expense or a PO / WO payment. */
export const PAY_TO_BOX_API = `${API}.get_pay_to_box`;
/** Change account on an expense: the server asks write permission; the screen offers it to Accounts. */
export const CHANGE_EXPENSE_ACCOUNT_API = `${API}.change_expense_account`;
export const ACCOUNTS_SEARCH_PAYEES_API = `${API}.search_payees`;
/** New bank details in Change account go through the Payees page's own endpoints (Accounts only). */
export const ACCOUNTS_CHECK_PAYEE_API = "nirmaan_stack.api.payees.add_payee.check_payee";
export const ACCOUNTS_ADD_PAYEE_API = "nirmaan_stack.api.payees.add_payee.add_payee";

/** Change account's picker searches, checks and adds Payees through the Accounts endpoints. */
export const ACCOUNTS_PAYEE_APIS: PayeeChoiceApis = {
    search: ACCOUNTS_SEARCH_PAYEES_API,
    check: ACCOUNTS_CHECK_PAYEE_API,
    add: ACCOUNTS_ADD_PAYEE_API,
};

export type PaidToKey = { doctype: string; name: string };

/** `take_vendor_accounts`' answer for one payment: the paid-to answer its write acted on, read under the
 *  lock. A switched payment's `switch_to` is exactly the account written onto it; an unswitched one
 *  keeps `account`. The bank file is built from these, never from the earlier read. */
export interface TakenVendorAccount {
    name: string;
    paid_to: PaidTo;
}
/** One PO / WO payment sent to `take_vendor_accounts`: the vendor's account the screen showed it is paid
 *  into (its `switch_to` as shown: Mark as Paid's confirmation, the Paid to cell), or null when it
 *  showed no switch. */
export interface ShownSwitch {
    name: string;
    shown: PayToAccount | null;
}

/** `take_vendor_accounts`' whole answer: the payments it took, and those it skipped as no longer
 *  Approved, which the screen leaves out of the marking and the bank file. */
export interface TakeVendorAccountsAnswer {
    taken: TakenVendorAccount[];
    skipped: SkippedPayment[];
}
export type { PaidTo, SkippedPayment };

/** `paid_to.pay_to_box`: the "Pay ₹X to" box for one row: its Paid to answer, plus the facts around it. */
export interface PayToBox extends PaidTo {
    account: PayToAccount | null;
    name: string;
    /** An expense's description: how Change account names it. Null on a PO / WO payment. */
    description: string | null;
    amount: number;
    vendor: string | null;
    vendor_name: string | null;
    /** An expense with a vendor is paid into that vendor's account: Change account can't pick another. */
    vendor_fixed: boolean;
    /** Money has left Approved: the account is read-only. */
    paid: boolean;
    named_by: NamedBy | null;
}

export const payToBoxKey = (doctype: string, name: string) => `pay_to_box:${doctype}:${name}`;
