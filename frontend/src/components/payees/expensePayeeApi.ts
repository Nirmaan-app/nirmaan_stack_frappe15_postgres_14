/**
 * Paying an expense (spec #1420 ticket #1431): the endpoints of `api/payees/expense_payee.py` and
 * what they return. The server's Payee module resolves who to pay (`services/payees/paid_to.py`).
 */

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import type { NamedBy, PaidTo } from "@/utils/payees/paidTo";

const API = "nirmaan_stack.api.payees.expense_payee";
/** Who each `{doctype, name}` row is paid to, read now (Export for Payment). */
export const PAID_TO_API = `${API}.get_paid_to`;
/** Record Payment's "Pay ₹X to" box. */
export const EXPENSE_PAYEE_API = `${API}.get_expense_payee`;
/** Change payee: Accounts only. */
export const CHANGE_EXPENSE_PAYEE_API = `${API}.change_expense_payee`;
export const ACCOUNTS_SEARCH_PAYEES_API = `${API}.search_payees`;
/** New bank details in Change payee go through the Payees page's own endpoints (Accounts only). */
export const ACCOUNTS_CHECK_PAYEE_API = "nirmaan_stack.api.payees.add_payee.check_payee";
export const ACCOUNTS_ADD_PAYEE_API = "nirmaan_stack.api.payees.add_payee.add_payee";

export type PaidToKey = { doctype: string; name: string };
export type { PaidTo };

/** `paid_to.expense_pay_to`: the "Pay ₹X to" box for one expense. */
export interface ExpensePayTo {
    name: string;
    amount: number;
    payee: PayeeSummary | null;
    payee_rule: string;
    vendor: string | null;
    vendor_name: string | null;
    /** A Project Expense with a vendor is paid into that vendor's Payee: Change payee can't pick another. */
    vendor_fixed: boolean;
    paid: boolean;
    named_by: NamedBy | null;
}

export const expensePayToKey = (doctype: string, name: string) => `expense_pay_to:${doctype}:${name}`;
