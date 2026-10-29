/**
 * The Non-Project Expense paying each claim (ADR-0040), read through the server because most claimants
 * can't read Non-Project Expenses (`api/reimbursements/claims.get_claim_payments`).
 *
 * Read only by the claim's detail sheet (the tables have no Payment column: owner, 2026-10-23).
 *
 * Every key starts with `CLAIM_PAYMENTS_KEY`, so `useRefreshClaimPayments` can refresh them all after a
 * decision: the key is the claims on screen, which an approve or reject does not change (code review finding 5).
 */

// useSWRConfig MUST come from frappe-react-sdk: the sdk bundles its own SWR, so swr's would see another cache.
import { useCallback } from "react";
import { useFrappeGetCall, useSWRConfig } from "frappe-react-sdk";

import type { ClaimPayment, Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import { APPROVED, PAID, REJECTED } from "@/utils/reimbursements/rules";

export const CLAIM_PAYMENTS_API = "nirmaan_stack.api.reimbursements.claims.get_claim_payments";
const CLAIM_PAYMENTS_KEY = "reimb_payments:";

export type ClaimPayments = Record<string, ClaimPayment>;

/** Only an Approved, Paid or Rejected claim can have an expense; a Pending one never has. */
const MAY_HAVE_PAYMENT = new Set<string>([APPROVED, PAID, REJECTED]);

export const claimsWithPayments = (claims: Pick<Reimbursement, "name" | "status">[]): string[] =>
    claims.filter((c) => MAY_HAVE_PAYMENT.has(c.status)).map((c) => c.name);

/** The payments of `names` (the claims on screen), by claim name; empty while loading. */
export function useClaimPayments(names: string[]): ClaimPayments {
    const sorted = [...names].sort();
    const { data } = useFrappeGetCall<{ message: ClaimPayments }>(
        CLAIM_PAYMENTS_API,
        { names: JSON.stringify(sorted) },
        sorted.length ? `${CLAIM_PAYMENTS_KEY}${sorted.join(",")}` : null,
    );
    return data?.message ?? {};
}

/** Refresh every claim-payments read: call after anything that can create, change or remove a claim's expense. */
export const useRefreshClaimPayments = () => {
    const { mutate } = useSWRConfig();
    return useCallback(
        () => mutate((key) => typeof key === "string" && key.startsWith(CLAIM_PAYMENTS_KEY)),
        [mutate],
    );
};
