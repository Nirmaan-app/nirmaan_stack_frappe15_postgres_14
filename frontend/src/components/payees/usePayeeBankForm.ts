/**
 * State for the four Payee bank fields (spec #1420): holder name, account number typed twice, IFSC.
 *
 * As the person types it asks the server two things, each debounced and in the change handler (never
 * an effect): the IFSC's bank and branch (`lookup_ifsc`), and, once both numbers match and the IFSC
 * has its shape, whether a Payee already holds that account (`check_payee`). A stale reply (the
 * field changed since) is dropped. The rules are pure, in `utils/payees/payeeForm.ts`.
 *
 * Add Payee uses it through `PayeeBankFields`; the vendor and Expense Request flows reuse both. Edit
 * (#1435) passes `editing`: the form starts from that Payee's account, the duplicate check leaves the
 * Payee itself out, and its own IFSC needs no lookup (`utils/payees/payeeEdit.ts`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { payeeEditForm, payeeEditKeepsIfsc } from "@/utils/payees/payeeEdit";
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

interface PayeeBankFormOptions {
    /**
     * The duplicate pre-check endpoint. Each screen asks through its own, which checks who may add a
     * Payee there: the Payees page `check_payee`, the vendor screens `vendor_payee.check_vendor_payee`.
     */
    checkApi?: string;
    /** The Payee being edited (#1435). Read once, when the form mounts: mount the form per edit. */
    editing?: Pick<PayeeSummary, "name" | "account_name" | "account_number" | "ifsc" | "bank_name" | "bank_branch">;
    /** The holder name an edit starts with, in place of the saved one (the vendor rename prompt). */
    holderName?: string;
}

export function usePayeeBankForm({
    checkApi = CHECK_PAYEE_API,
    editing,
    holderName,
}: PayeeBankFormOptions = {}): PayeeBankForm {
    const [start] = useState<PayeeFormValues>(() => (editing ? payeeEditForm(editing, holderName) : EMPTY_PAYEE_FORM));
    const exclude = editing?.name;
    const [form, setForm] = useState<PayeeFormValues>(start);
    // An edit starts with the Payee's saved bank and branch: they stand while its IFSC does.
    const [startBank] = useState<BankBranch | null>(() =>
        editing?.bank_name ? { bank_name: editing.bank_name, bank_branch: editing.bank_branch ?? "" } : null,
    );
    const [bank, setBank] = useState<BankBranch | null>(startBank);
    const [ifscError, setIfscError] = useState<string | null>(null);
    const [duplicate, setDuplicate] = useState<PayeeSummary | null>(null);
    const [lookingUp, setLookingUp] = useState(false);

    const { call: callLookup } = useFrappePostCall<{ message: BankBranch }>(LOOKUP_IFSC_API);
    const { call: callCheck } = useFrappePostCall<{ message: { duplicate: PayeeSummary | null } }>(checkApi);

    const ifscTimer = useRef<ReturnType<typeof setTimeout>>();
    const checkTimer = useRef<ReturnType<typeof setTimeout>>();
    const latest = useRef<PayeeFormValues>(start);

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
                    const res = await callCheck({
                        account_number: next.account_number,
                        ifsc: cleanIfsc(next.ifsc),
                        ...(exclude ? { exclude } : {}),
                    });
                    const now = latest.current;
                    if (`${now.account_number}|${now.ifsc}` === key) setDuplicate(res.message.duplicate);
                } catch {
                    // The submit re-checks on the server; a failed pre-check blocks nothing.
                }
            }, DEBOUNCE_MS);
        },
        [callCheck, exclude],
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
        latest.current = start;
        setForm(start);
        setBank(startBank);
        setIfscError(null);
        setDuplicate(null);
        setLookingUp(false);
    }, [start, startBank]);

    return {
        form,
        setField,
        bank,
        lookingUp,
        ifscError,
        duplicate,
        setDuplicate,
        problem: payeeFormProblem(form, { bankFound: !!bank || payeeEditKeepsIfsc(editing, form.ifsc) }),
        reset,
    };
}
