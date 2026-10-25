// src/pages/ExpenseRequests/hooks/useRequestStanding.ts
//
// The one reader of `get_request_standing` (#1500): each named request's LIVE status, amount and
// "Where it stands" steps, read from its Expense on the server. The Expenses list asks for the
// rows on screen. The request page gets the same `standing` inside `read.get_expense_request`.

import { useFrappeGetCall } from "frappe-react-sdk";

import type { GetRequestStandingResponse, RequestStanding } from "@/types/NirmaanStack/ExpenseRequest";

export const REQUEST_STANDING_API = "nirmaan_stack.api.expense_requests.standing.get_request_standing";

/** Live standing of `names`, keyed by request name. A name the caller may not read is absent. */
export function useRequestStanding(names: string[]): {
    standing: Record<string, RequestStanding>;
    isLoading: boolean;
    mutate: () => void;
} {
    const sorted = [...names].sort();
    // SWR keys on this string alone, so it carries the names; null fetches nothing.
    const key = sorted.length ? `exr_standing:${sorted.join(",")}` : null;
    const { data, isLoading, mutate } = useFrappeGetCall<{ message: GetRequestStandingResponse }>(
        REQUEST_STANDING_API,
        sorted.length ? { names: JSON.stringify(sorted) } : undefined,
        key,
    );
    return { standing: data?.message ?? {}, isLoading, mutate: () => { void mutate(); } };
}
