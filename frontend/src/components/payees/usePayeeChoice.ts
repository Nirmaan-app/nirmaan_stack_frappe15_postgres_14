/**
 * State for choosing who gets paid (spec #1420 ticket #1429): pick an existing Payee, or add a new
 * one with the same fields and rules as Add Payee. `PayeePicker` renders it.
 *
 * Reusable on purpose: the Expense Request dialog uses it, request formats' name fields give way to
 * it (#1430), and Record Payment's "Change account" reuses it (#1431, #1438). Each screen calls `resolve()`
 * when it saves: a pick comes back as is (a Payee, or an edited request's own account kept,
 * `utils/payees/payToChoice`); new details are added first through
 * `api/expense_requests/payees.add_request_payee` (open to anyone who can raise a request). An
 * account already on record is not added twice: its Payee shows in the duplicate block, to pick.
 */

import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { PayeeOption, PayeeSummary } from "@/types/NirmaanStack/Payee";
import { cleanIfsc, newPayeeProblem, refusesOwnAccount } from "@/utils/payees/payeeForm";
import { DuplicatePayeeError, type PickedPayTo } from "@/utils/payees/payToChoice";

import { usePayeeBankForm, type PayeeBankForm } from "./usePayeeBankForm";

const API = "nirmaan_stack.api.expense_requests.payees";
export const SEARCH_PAYEES_API = `${API}.search_payees`;
export const CHECK_REQUEST_PAYEE_API = `${API}.check_request_payee`;
export const ADD_REQUEST_PAYEE_API = `${API}.add_request_payee`;

export type PayeeChoiceMode = "pick" | "new";

type AddReply = { payee: PayeeSummary } | { duplicate: PayeeSummary; message: string };

/** What `resolve()` throws on a duplicate account; it lives in `utils/payees/payToChoice` (pure). */
export { DuplicatePayeeError };

export interface PayeeChoice {
    mode: PayeeChoiceMode;
    setMode: (mode: PayeeChoiceMode) => void;
    /** What is picked (pick mode): a Payee, or an edited request's own account kept. */
    picked: PickedPayTo | null;
    /** Pick a Payee (or clear with null); switches to pick mode. */
    pick: (payee: PayeeOption | null) => void;
    bankForm: PayeeBankForm;
    /** A Payee is picked, or complete new details are filled in. */
    hasChoice: boolean;
    /** Why what is on screen can't be saved yet (new details half filled in, a duplicate), or null. */
    problem: string | null;
    /** The new Payee is being added. */
    adding: boolean;
    /** What to save: the pick, or the new Payee, added now. None chosen: null. */
    resolve: () => Promise<PickedPayTo | null>;
    /** Start again, picking `seed` (a request's own account when editing it). */
    reset: (seed?: PickedPayTo | null) => void;
    /** Where the picker searches Payees. */
    searchApi: string;
    /** A person's own account can't be used here (`PayeeChoiceApis.refusesOwnAccount`). */
    refusesOwnAccount: boolean;
}

/** The endpoints a screen searches, checks and adds Payees through: the request's (anyone who can
 *  raise one) by default; Record Payment's Change account passes the Accounts ones. */
export interface PayeeChoiceApis {
    search: string;
    check: string;
    add: string;
    /** A person's own account (Users) can't be used here: the duplicate block refuses it instead of
     *  offering it. The request's screen only (owner, 2026-10-27); its search already leaves them out. */
    refusesOwnAccount?: boolean;
}

const REQUEST_APIS: PayeeChoiceApis = {
    search: SEARCH_PAYEES_API,
    check: CHECK_REQUEST_PAYEE_API,
    add: ADD_REQUEST_PAYEE_API,
    refusesOwnAccount: true,
};

export function usePayeeChoice(apis: PayeeChoiceApis = REQUEST_APIS): PayeeChoice {
    const [mode, setMode] = useState<PayeeChoiceMode>("pick");
    const [picked, setPicked] = useState<PickedPayTo | null>(null);
    const bankForm = usePayeeBankForm({ checkApi: apis.check });
    const { call: callAdd, loading: adding } = useFrappePostCall<{ message: AddReply }>(apis.add);

    const { form, problem: formProblem, duplicate, lookingUp, reset: resetBank, setDuplicate } = bankForm;
    const typedAnything = Object.values(form).some((v) => v.trim());
    const ownAccountRefused = refusesOwnAccount(apis.refusesOwnAccount, duplicate);
    const newProblem = typedAnything
        ? newPayeeProblem({ formProblem, duplicate: !!duplicate, lookingUp, ownAccountRefused })
        : null;

    const hasChoice = mode === "pick" ? !!picked : typedAnything && !newProblem;
    const problem = mode === "new" ? newProblem : null;

    const pick = useCallback((payee: PayeeOption | null) => {
        setPicked(payee ? { kind: "payee", payee } : null);
        setMode("pick");
    }, []);

    const resolve = useCallback(async (): Promise<PickedPayTo | null> => {
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
        const added: PickedPayTo = { kind: "payee", payee: reply.payee };
        resetBank();
        setPicked(added);
        setMode("pick");
        return added;
    }, [mode, picked, typedAnything, callAdd, form, setDuplicate, resetBank]);

    const reset = useCallback(
        (seed: PickedPayTo | null = null) => {
            resetBank();
            setPicked(seed);
            setMode("pick");
        },
        [resetBank],
    );

    return {
        mode, setMode, picked, pick, bankForm, hasChoice, problem, adding, resolve, reset,
        searchApi: apis.search,
        refusesOwnAccount: !!apis.refusesOwnAccount,
    };
}
