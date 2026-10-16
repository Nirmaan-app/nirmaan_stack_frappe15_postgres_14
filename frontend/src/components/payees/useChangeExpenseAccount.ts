/**
 * Change account's save (spec #1420 tickets #1431, #1438, #1465): read what the picker chose, then copy
 * it onto the expense through `api/payees/paid_to.change_expense_account`. Record Payment's Change
 * account dialog and the expense Edit dialogs' Who gets paid both save through these two steps, so a
 * new Payee is added (and a duplicate stops the save) before anything is written.
 */

import { useCallback } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { CHANGE_EXPENSE_ACCOUNT_API, type PayToBox } from "./paidToApi";
import type { PayeeChoice } from "./usePayeeChoice";

/**
 * The Payee to copy (a new one is added now), null to remove the account, or undefined when there is
 * nothing to save: no Payee chosen. Throws `DuplicatePayeeError` when new details are already on
 * record. Only a Payee is copied: Change account never seeds the expense's own account as the pick.
 */
export async function chosenExpensePayee(choice: PayeeChoice, remove: boolean): Promise<string | null | undefined> {
    if (remove) return null;
    const picked = await choice.resolve();
    return picked?.kind === "payee" ? picked.payee.name : undefined;
}

/** Copy Payee `payee` (null: no account) onto the expense; resolves to its new "Pay ₹X to" box. */
export function useChangeExpenseAccount() {
    const { call, loading } = useFrappePostCall<{ message: PayToBox }>(CHANGE_EXPENSE_ACCOUNT_API);
    const change = useCallback(
        async (doctype: string, name: string, payee: string | null): Promise<PayToBox> =>
            (await call({ doctype, name, payee })).message,
        [call],
    );
    return { change, loading };
}
