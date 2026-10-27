/**
 * "Who gets paid" in the Raise dialog: the claimant's one bank account, shown as the expense forms show a
 * picked payee (`PayeeReadOnly`), or -- when they have none yet -- "Add Your Account" with the Add Payee fields
 * inline and an "Add Account" button.
 *
 * The account is the Payee in the person's `Nirmaan Users.payee` field (`services/payees/own_accounts`), one per
 * person, so there is nothing to pick: every claim is repaid into it. It is changed on the profile's Payee tab,
 * never here. Adding it goes through `add_my_bank_account`: a new account becomes a Payee and theirs; one
 * already on record with nobody's name on it becomes theirs; another person's is refused with that reason.
 * So the form runs no duplicate pre-check (`checkApi: null`).
 */

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { PayeeBankFields } from "@/components/payees/PayeeBankFields";
import { PayeeReadOnly } from "@/components/payees/PayeePicker";
import { usePayeeBankForm } from "@/components/payees/usePayeeBankForm";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import type { OwnBankAccount } from "@/types/NirmaanStack/Reimbursement";
import { getFrappeError } from "@/utils/frappeErrors";
import { cleanIfsc } from "@/utils/payees/payeeForm";

export const ADD_MY_BANK_ACCOUNT_API = "nirmaan_stack.api.reimbursements.bank_accounts.add_my_bank_account";

interface AddReply {
    payee: string;
    outcome: "added" | "linked" | "already_yours";
    message: string;
    account: OwnBankAccount | null;
}

interface Props {
    account: OwnBankAccount | null;
    loading: boolean;
    /** After the account is added: the saved account, so the parent's cache can take it. */
    onAdded: (account: OwnBankAccount | null) => void;
    disabled?: boolean;
    error?: string | null;
}

export function BankAccountSection({ account, loading, onAdded, disabled, error }: Props) {
    const { user_id } = useUserData();
    const [notice, setNotice] = useState<string | null>(null);
    const [addError, setAddError] = useState<string | null>(null);
    const payeeForm = usePayeeBankForm({ checkApi: null });
    const { call, loading: saving } = useFrappePostCall<{ message: AddReply }>(ADD_MY_BANK_ACCOUNT_API);

    const save = async () => {
        setAddError(null);
        try {
            const res = await call({
                account_name: payeeForm.form.account_name,
                account_number: payeeForm.form.account_number,
                ifsc: cleanIfsc(payeeForm.form.ifsc),
            });
            onAdded(res.message.account);
            setNotice(res.message.message);
            payeeForm.reset();
        } catch (e) {
            setAddError(getFrappeError(e));
        }
    };

    // First time (no account yet): the section asks them to add one.
    const adding = !account && !loading;

    return (
        <section className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4" aria-labelledby="reimb-payto-heading">
            <div>
                <h3 id="reimb-payto-heading" className="text-sm font-semibold">
                    {adding ? "Add Your Account" : "Who gets paid"} <span className="text-destructive">*</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                    {!adding
                        ? "Your bank account. Accounts repays this claim into it; its details are copied onto the claim."
                        : "Add the bank account you'll be repaid into. It's saved as yours and used for every claim."}
                </p>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading your bank account...</p>
            ) : account ? (
                <>
                    <PayeeReadOnly payee={account} />
                    {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
                    <p className="text-xs text-muted-foreground">
                        Wrong account?{" "}
                        <Link to={`/users/${encodeURIComponent(user_id)}?tab=payees`} className="font-medium text-primary hover:underline">
                            Edit it on your profile
                        </Link>
                        .
                    </p>
                </>
            ) : (
                <div className="flex flex-col gap-3">
                    <PayeeBankFields payeeForm={payeeForm} layout="form" disabled={saving || disabled} />
                    {addError && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{addError}</p>}
                    <Button
                        type="button"
                        size="sm"
                        className="self-start"
                        onClick={save}
                        disabled={saving || disabled || payeeForm.lookingUp || !!payeeForm.problem}
                        title={payeeForm.problem ?? undefined}
                    >
                        {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Add Account
                    </Button>
                </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </section>
    );
}
