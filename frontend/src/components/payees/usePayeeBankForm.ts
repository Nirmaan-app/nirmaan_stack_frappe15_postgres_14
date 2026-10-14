/**
 * State for the four Payee bank fields (spec #1420): holder name, account number typed twice, IFSC.
 *
 * As the person types it asks the server two things, each debounced and in the change handler (never
 * an effect): the IFSC's bank and branch (`lookup_ifsc`), and, once both numbers match and the IFSC
 * has its shape, whether a Payee already holds that account (`check_payee`). A stale reply (the
 * field changed since) is dropped. The rules are pure, in `utils/payees/payeeForm.ts`.
 *
 * Add Payee uses it through `PayeeBankFields`; the vendor and Expense Request flows reuse both.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import {
    EMPTY_PAYEE_FORM,
    accountsMatch,
    cleanIfsc,
    isIfscShaped,
    payeeFormProblem,
    type PayeeFormValues,
} from "@/utils/payees/payeeForm";

export const LOOKUP_IFSC_API = "nirmaan_stack.api.payees.add_payee.lookup_ifsc";
export const CHECK_PAYEE_API = "nirmaan_stack.api.payees.add_payee.check_payee";

const DEBOUNCE_MS = 500;

export interface BankBranch {
    bank_name: string;
    bank_branch: string;
}

export interface PayeeBankForm {
    form: PayeeFormValues;
    setField: (field: keyof PayeeFormValues, value: string) => void;
    /** The IFSC's bank and branch, once the lookup found them. */
    bank: BankBranch | null;
    lookingUp: boolean;
    ifscError: string | null;
    /** The Payee that already holds this account + IFSC, if any. Submitting is blocked while set. */
    duplicate: PayeeSummary | null;
    /** Set the duplicate the server reported on submit (a race the pre-check missed). */
    setDuplicate: (dup: PayeeSummary | null) => void;
    /** Why the form can't be submitted yet, or null. */
    problem: string | null;
    reset: () => void;
}

export function usePayeeBankForm(): PayeeBankForm {
    const [form, setForm] = useState<PayeeFormValues>(EMPTY_PAYEE_FORM);
    const [bank, setBank] = useState<BankBranch | null>(null);
    const [ifscError, setIfscError] = useState<string | null>(null);
    const [duplicate, setDuplicate] = useState<PayeeSummary | null>(null);
    const [lookingUp, setLookingUp] = useState(false);

    const { call: callLookup } = useFrappePostCall<{ message: BankBranch }>(LOOKUP_IFSC_API);
    const { call: callCheck } = useFrappePostCall<{ message: { duplicate: PayeeSummary | null } }>(CHECK_PAYEE_API);

    const ifscTimer = useRef<ReturnType<typeof setTimeout>>();
    const checkTimer = useRef<ReturnType<typeof setTimeout>>();
    const latest = useRef<PayeeFormValues>(EMPTY_PAYEE_FORM);

    useEffect(
        () => () => {
            clearTimeout(ifscTimer.current);
            clearTimeout(checkTimer.current);
        },
        [],
    );

    const lookUp = useCallback(
        (ifsc: string) => {
            clearTimeout(ifscTimer.current);
            setBank(null);
            setIfscError(null);
            if (!isIfscShaped(ifsc)) {
                setLookingUp(false);
                return;
            }
            setLookingUp(true);
            ifscTimer.current = setTimeout(async () => {
                try {
                    const res = await callLookup({ ifsc });
                    if (cleanIfsc(latest.current.ifsc) === ifsc) setBank(res.message);
                } catch (e) {
                    if (cleanIfsc(latest.current.ifsc) === ifsc) setIfscError(getFrappeError(e));
                } finally {
                    if (cleanIfsc(latest.current.ifsc) === ifsc) setLookingUp(false);
                }
            }, DEBOUNCE_MS);
        },
        [callLookup],
    );

    const check = useCallback(
        (next: PayeeFormValues) => {
            clearTimeout(checkTimer.current);
            setDuplicate(null);
            if (!accountsMatch(next) || !isIfscShaped(next.ifsc)) return;
            const key = `${next.account_number}|${next.ifsc}`;
            checkTimer.current = setTimeout(async () => {
                try {
                    const res = await callCheck({ account_number: next.account_number, ifsc: cleanIfsc(next.ifsc) });
                    const now = latest.current;
                    if (`${now.account_number}|${now.ifsc}` === key) setDuplicate(res.message.duplicate);
                } catch {
                    // The submit re-checks on the server; a failed pre-check blocks nothing.
                }
            }, DEBOUNCE_MS);
        },
        [callCheck],
    );

    const setField = useCallback(
        (field: keyof PayeeFormValues, value: string) => {
            const next = { ...latest.current, [field]: field === "ifsc" ? value.toUpperCase() : value };
            latest.current = next;
            setForm(next);
            if (field === "ifsc") lookUp(cleanIfsc(next.ifsc));
            if (field !== "account_name") check(next);
        },
        [lookUp, check],
    );

    const reset = useCallback(() => {
        clearTimeout(ifscTimer.current);
        clearTimeout(checkTimer.current);
        latest.current = EMPTY_PAYEE_FORM;
        setForm(EMPTY_PAYEE_FORM);
        setBank(null);
        setIfscError(null);
        setDuplicate(null);
        setLookingUp(false);
    }, []);

    return {
        form,
        setField,
        bank,
        lookingUp,
        ifscError,
        duplicate,
        setDuplicate,
        problem: payeeFormProblem(form, { bankFound: !!bank }),
        reset,
    };
}
