/**
 * The month totals of some claims, or of the Non-Project Expenses created from claims (ADR-0040 Amendment B), from
 * `api/reimbursements/month_totals.get_month_totals`. Read fresh each time a dialog asks: the total is worked out
 * on the server when it is read, never stored. Pass `null`, or empty lists, to fetch nothing.
 */

import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { MonthTotal } from "@/types/NirmaanStack/Reimbursement";

const API = "nirmaan_stack.api.reimbursements.month_totals.get_month_totals";

export interface MonthTotalsAsk {
    claims?: readonly string[];
    expenses?: readonly string[];
}

export function useMonthTotals(ask: MonthTotalsAsk | null) {
    const claims = ask?.claims ?? [];
    const expenses = ask?.expenses ?? [];
    const enabled = claims.length + expenses.length > 0;
    const key = enabled ? `reimb_month_totals:${claims.join(",")}|${expenses.join(",")}` : null;
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: MonthTotal[] }>(
        API,
        enabled ? { claims: JSON.stringify(claims), expenses: JSON.stringify(expenses) } : undefined,
        key,
        { revalidateOnFocus: false, revalidateOnMount: true },
    );
    const rows = useMemo(() => data?.message ?? [], [data]);
    const byClaim = useMemo(() => new Map(rows.map((r) => [r.claim, r])), [rows]);
    const byExpense = useMemo(
        () => new Map(rows.filter((r) => r.expense).map((r) => [r.expense as string, r])),
        [rows],
    );
    // `refresh`: read the totals again, e.g. when the server refused an approval because the month moved on since
    // the dialog opened (another approval in another window).
    return { rows, byClaim, byExpense, isLoading: enabled && isLoading, failed: enabled && !!error, refresh: mutate };
}
