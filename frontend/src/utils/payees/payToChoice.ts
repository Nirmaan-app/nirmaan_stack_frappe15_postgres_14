/**
 * What a "who gets paid" pick holds, and what saving it sends (spec #1420 tickets #1429, #1436,
 * ADR-0033). Pure, so it tests without React; `usePayeeChoice` holds the state.
 *
 * A pick is a Payee from the address book, or, when a request is edited, the request's own pay-to
 * account kept as it is. That account is a copy, not a Payee: it has no name to send, so keeping it
 * is its own answer (`keep_pay_to`), and a Payee edited since moves nothing.
 */

import type { PayeeOption, PayToAccount } from "@/types/NirmaanStack/Payee";

export type PickedPayTo =
    | { kind: "payee"; payee: PayeeOption }
    | { kind: "own"; account: PayToAccount };

/** The account a pick shows. */
export const pickedAccount = (picked: PickedPayTo): PayToAccount =>
    picked.kind === "payee" ? picked.payee : picked.account;

/** Who gets paid as the request's save takes it (`api/expense_requests` create / update). */
export type PayToSave = { keep_pay_to: true } | { payee: string } | Record<string, never>;

/** Keep the request's own account, copy the picked Payee's, or (nothing picked) none. */
export const payToSave = (picked: PickedPayTo | null): PayToSave => {
    if (!picked) return {};
    return picked.kind === "own" ? { keep_pay_to: true } : { payee: picked.payee.name };
};
