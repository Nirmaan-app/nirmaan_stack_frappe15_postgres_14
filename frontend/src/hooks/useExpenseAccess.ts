/**
 * Whether the viewer gets the Expenses page (spec #1494, #1506): the server's answer, read once and
 * shared through SWR by the sidebar, the dashboard card and the `/expense` route guard. The rule is
 * `utils/expenseAccess`.
 */
import { useFrappeGetCall } from "frappe-react-sdk";

import { EXPENSE_ACCESS_API, ExpenseAccess } from "@/utils/expenseAccess";

export function useExpenseAccess(): { access: ExpenseAccess | undefined; failed: boolean } {
    const { data, error } = useFrappeGetCall<{ message: ExpenseAccess }>(
        EXPENSE_ACCESS_API,
        undefined,
        EXPENSE_ACCESS_API,
        { revalidateOnFocus: false },
    );
    return { access: data?.message, failed: !!error };
}
