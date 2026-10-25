/**
 * The challan list's Link / Unlink of a TDS Payment expense (#1544): the candidate expenses and the write.
 *
 * The write is `api/tds_challan/challan_expense.set_challan_expense`, a document save, so the server's
 * rule (TDS Payment type, not Rejected, on no other challan) refuses whatever slips past the picker.
 */

import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";

import { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";
import { TDS_PAYMENT_EXPENSE_TYPE } from "../challanExpense";

const SET_CHALLAN_EXPENSE = "nirmaan_stack.api.tds_challan.challan_expense.set_challan_expense";

export type TdsPaymentExpense = Pick<
    NonProjectExpenses,
    "name" | "amount" | "payment_date" | "status" | "description"
>;

/** `enabled` false fetches nothing (the dialog is closed). */
export function useChallanExpenseLink(enabled: boolean) {
    const { data: expenses, isLoading: isExpensesLoading } = useFrappeGetDocList<TdsPaymentExpense>(
        "Non Project Expenses",
        {
            fields: ["name", "amount", "payment_date", "status", "description"],
            filters: [
                ["type", "=", TDS_PAYMENT_EXPENSE_TYPE],
                ["status", "!=", "Rejected"],
            ],
            limit: 1000,
            orderBy: { field: "creation", order: "desc" },
        },
        enabled ? undefined : null
    );

    const { call, loading: isSaving } = useFrappePostCall(SET_CHALLAN_EXPENSE);

    const setChallanExpense = (challan: string, expense: string | null) =>
        call({ challan, expense });

    return { expenses: expenses ?? [], isExpensesLoading, setChallanExpense, isSaving };
}
