/**
 * State for choosing who gets paid (spec #1420 ticket #1429): pick an existing Payee, or add a new
 * one with the same fields and rules as Add Payee. `PayeePicker` renders it.
 *
 * Reusable on purpose: the Expense Request dialog uses it, request formats' name fields give way to
 * it (#1430), and Record Payment's "Change payee" reuses it (#1431). Each screen calls `resolve()`
 * when it saves: a picked Payee comes back as is; new details are added first through
 * `api/expense_requests/payees.add_request_payee` (open to anyone who can raise a request). An
 * account already on record is not added twice: its Payee shows in the duplicate block, to pick.
 */

import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { PayeeOption, PayeeSummary } from "@/types/NirmaanStack/Payee";
import { cleanIfsc } from "@/utils/payees/payeeForm";

import { usePayeeBankForm, type PayeeBankForm } from "./usePayeeBankForm";

const API = "nirmaan_stack.api.expense_requests.payees";
export const SEARCH_PAYEES_API = `${API}.search_payees`;
export const CHECK_REQUEST_PAYEE_API = `${API}.check_request_payee`;
export const ADD_REQUEST_PAYEE_API = `${API}.add_request_payee`;
export const GET_VENDOR_PAYEE_API = `${API}.get_vendor_payee`;

export type PayeeChoiceMode = "pick" | "new";

type AddReply = { payee: PayeeSummary } | { duplicate: PayeeSummary; message: string };

/** Thrown by `resolve()` when the new details belong to a Payee already on record. The duplicate
 *  block now shows that Payee, so the screen only has to stop saving and say why. */
export class DuplicatePayeeError extends Error {}

export interface PayeeChoice {
    mode: PayeeChoiceMode;
    setMode: (mode: PayeeChoiceMode) => void;
    /** The Payee picked (pick mode). */
    picked: PayeeOption | null;
    /** Pick a Payee (or clear with null); switches to pick mode. */
    pick: (payee: PayeeOption | null) => void;
    bankForm: PayeeBankForm;
    /** A Payee is picked, or complete new details are filled in. */
    hasChoice: boolean;
    /** Why what is on screen can't be saved yet (new details half filled in, a duplicate), or null. */
    problem: string | null;
    /** The new Payee is being added. */
    adding: boolean;
    /** The Payee to save: the picked one, or the new one, added now. None chosen: null. */
    resolve: () => Promise<PayeeOption | null>;
    /** Start again, picking `seed` (a request's own Payee when editing it). */
    reset: (seed?: PayeeOption | null) => void;
    /** Where the picker searches Payees. */
    searchApi: string;
}

/** The endpoints a screen searches, checks and adds Payees through: the request's (anyone who can
 *  raise one) by default; Record Payment's Change payee passes the Accounts ones. */
export interface PayeeChoiceApis {
    search: string;
    check: string;
    add: string;
}

const REQUEST_APIS: PayeeChoiceApis = {
    search: SEARCH_PAYEES_API,
    check: CHECK_REQUEST_PAYEE_API,
    add: ADD_REQUEST_PAYEE_API,
};

export function usePayeeChoice(apis: PayeeChoiceApis = REQUEST_APIS): PayeeChoice {
    const [mode, setMode] = useState<PayeeChoiceMode>("pick");
    const [picked, setPicked] = useState<PayeeOption | null>(null);
    const bankForm = usePayeeBankForm({ checkApi: apis.check });
    const { call: callAdd, loading: adding } = useFrappePostCall<{ message: AddReply }>(apis.add);

    const { form, problem: formProblem, duplicate, lookingUp, reset: resetBank, setDuplicate } = bankForm;
    const typedAnything = Object.values(form).some((v) => v.trim());
    const newProblem = !typedAnything
        ? null
        : duplicate
          ? "This account is already a payee. Pick it instead."
          : lookingUp
            ? "Looking up the IFSC..."
            : formProblem;

    const hasChoice = mode === "pick" ? !!picked : typedAnything && !newProblem;
    const problem = mode === "new" ? newProblem : null;

    const pick = useCallback((payee: PayeeOption | null) => {
        setPicked(payee);
        setMode("pick");
    }, []);

    const resolve = useCallback(async (): Promise<PayeeOption | null> => {
        if (mode === "pick") return picked;
        if (!typedAnything) return null;
        const res = await callAdd({
            account_name: form.account_name,
            account_number: form.account_number,
            ifsc: cleanIfsc(form.ifsc),
        });
        const reply = res.message;
        if ("duplicate" in reply) {
            setDuplicate(reply.duplicate);
            throw new DuplicatePayeeError(reply.message);
        }
        // Added: from now on it is the picked Payee, so a failed save after this re-uses it.
        resetBank();
        setPicked(reply.payee);
        setMode("pick");
        return reply.payee;
    }, [mode, picked, typedAnything, callAdd, form, setDuplicate, resetBank]);

    const reset = useCallback(
        (seed: PayeeOption | null = null) => {
            resetBank();
            setPicked(seed);
            setMode("pick");
        },
        [resetBank],
    );

    return { mode, setMode, picked, pick, bankForm, hasChoice, problem, adding, resolve, reset, searchApi: apis.search };
}
