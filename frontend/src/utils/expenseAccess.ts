/**
 * Who gets the Expenses page (spec #1494, #1506): someone who can raise at least one expense type, or
 * who reviews. The server decides it (`api/expense_requests/access.opens_expenses`, served by
 * `read.get_expense_access`) from the same `Expense Type.allowed_roles` the request-creating call
 * enforces, so the sidebar item, the dashboard card and the `/expense` route read one answer.
 * Pure, so it tests without React; `hooks/useExpenseAccess` fetches it.
 */
import type { RoleRouteState } from "@/utils/auth/ProtectedRoute";

export const EXPENSE_ACCESS_API = "nirmaan_stack.api.expense_requests.read.get_expense_access";

/** The server's answer. */
export interface ExpenseAccess {
    opens_expenses: boolean;
}

/** What the `/expense` route shows: the page once the server says yes, a loading state while it has
 *  not answered, "Access Denied" once it says no or the read fails. */
export function expenseRouteState(access: ExpenseAccess | undefined, failed: boolean): RoleRouteState {
    if (access?.opens_expenses) return "allow";
    if (!access && !failed) return "loading";
    return "deny";
}

/** Whether the sidebar shows the Expenses item: only once the server has said yes. */
export const showsExpenses = (access: ExpenseAccess | undefined): boolean => !!access?.opens_expenses;
