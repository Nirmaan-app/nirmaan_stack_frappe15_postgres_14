/**
 * Add Expense's save of a Direct Expense (spec #1470 tickets #1471, #1474): the Project and the
 * Non-Project Add Expense dialogs both record one through `api/expenses/direct_expense.create_direct_expense`,
 * which saves the expense and copies its pay-to account in one step. This hook holds what the two
 * share: the *Who gets paid* choice (`usePayeeChoice`, the request's), resolved before anything else
 * so a duplicate account stops the save before any upload, and the save itself.
 */

import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";
import type { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { payToSave } from "@/utils/payees/payToChoice";

import { usePayeeChoice } from "./usePayeeChoice";

export const CREATE_DIRECT_EXPENSE_API = "nirmaan_stack.api.expenses.direct_expense.create_direct_expense";

/** The fields each ledger's dialog sends for its new expense, by doctype. */
export interface DirectExpenseFields {
    "Project Expenses": Partial<ProjectExpenses>;
    "Non Project Expenses": Partial<NonProjectExpenses>;
}

/** The two ledgers a Direct Expense is recorded on. */
export type DirectExpenseDoctype = keyof DirectExpenseFields;

/** What the server returns for the expense it created; `status` names the path it took. */
export interface CreatedDirectExpense {
    name: string;
    status: string;
}

/**
 * The *Who gets paid* choice and the save of a Direct Expense on `doctype`.
 *
 * `create(sendsPayee, buildExpense)` resolves who gets paid first when `sendsPayee` (new payee details
 * are added now; a duplicate throws `DuplicatePayeeError`), then calls `buildExpense` (the dialog's
 * uploads and fields), then saves. `loading` is true for that whole save, the payee add included, so
 * a dialog that blocks closing on it cannot be closed while an add is still to land its pick.
 */
export function useCreateDirectExpense<D extends DirectExpenseDoctype>(doctype: D) {
    const payeeChoice = usePayeeChoice();
    const { resolve } = payeeChoice;
    const { call } = useFrappePostCall<{ message: CreatedDirectExpense }>(CREATE_DIRECT_EXPENSE_API);
    const [loading, setLoading] = useState(false);

    const create = useCallback(
        async (
            sendsPayee: boolean,
            buildExpense: () => Promise<DirectExpenseFields[D]>,
        ): Promise<CreatedDirectExpense | undefined> => {
            setLoading(true);
            try {
                const payTo = sendsPayee ? payToSave(await resolve()) : {};
                const expense = await buildExpense();
                const res = await call({ doctype, expense, ...payTo });
                return res?.message;
            } finally {
                setLoading(false);
            }
        },
        [doctype, call, resolve],
    );

    return { payeeChoice, create, loading };
}
