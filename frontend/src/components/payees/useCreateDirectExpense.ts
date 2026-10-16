/**
 * Add Expense's save of a Direct Expense (spec #1470 tickets #1471, #1474): the Project and the
 * Non-Project Add Expense dialogs both record one through `api/expenses/direct_expense.create_direct_expense`,
 * which saves the expense and copies its pay-to account in one step. This hook holds what the two
 * share: the *Who gets paid* choice (`usePayeeChoice`, the request's), resolved before anything else
 * so a duplicate account stops the save before any upload, and the save itself.
 */

import { useCallback } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { getFrappeError } from "@/utils/frappeErrors";
import { payToSave } from "@/utils/payees/payToChoice";

import { DuplicatePayeeError, usePayeeChoice } from "./usePayeeChoice";

export const CREATE_DIRECT_EXPENSE_API = "nirmaan_stack.api.expenses.direct_expense.create_direct_expense";

/** The two ledgers a Direct Expense is recorded on. */
export type DirectExpenseDoctype = "Project Expenses" | "Non Project Expenses";

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
 * uploads and fields), then saves. `changeType(from, to)` clears the choice when the expense type
 * changes, so a pick made under one type is not carried to another.
 */
export function useCreateDirectExpense(doctype: DirectExpenseDoctype) {
    const payeeChoice = usePayeeChoice();
    const { resolve, reset } = payeeChoice;
    const { call, loading } = useFrappePostCall<{ message: CreatedDirectExpense }>(CREATE_DIRECT_EXPENSE_API);

    const create = useCallback(
        async (sendsPayee: boolean, buildExpense: () => Promise<object>): Promise<CreatedDirectExpense | undefined> => {
            const payTo = sendsPayee ? payToSave(await resolve()) : {};
            const expense = await buildExpense();
            const res = await call({ doctype, expense, ...payTo });
            return res?.message;
        },
        [doctype, call, resolve],
    );

    const changeType = useCallback(
        (from: string, to: string) => {
            if (from !== to) reset();
        },
        [reset],
    );

    return { payeeChoice, create, loading, changeType };
}

/** The toast for a failed save: a duplicate account says so (its Payee now shows to pick); anything
 *  else gives the server's reason, or `fallback`. */
export const directExpenseErrorToast = (error: unknown, title: string, fallback: string) =>
    error instanceof DuplicatePayeeError
        ? { title: "This account is already a payee", description: error.message, variant: "destructive" as const }
        : { title, description: getFrappeError(error) || fallback, variant: "destructive" as const };
