/**
 * One Payee's page data (#1423): `api/payees/payee_page.get_payee`, typed once here (F2).
 */

import { useFrappeGetCall } from "frappe-react-sdk";

import type { PayeePage } from "@/types/NirmaanStack/Payee";

export const PAYEE_PAGE_API = "nirmaan_stack.api.payees.payee_page.get_payee";

/** The page for Payee `name`; `mutate` refetches it after an edit. */
export const usePayeePage = (name: string) => {
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: PayeePage }>(
        PAYEE_PAGE_API,
        { name },
        `payee_page_${name}`,
    );
    return { payee: data?.message, error, isLoading, mutate };
};
