/**
 * The expense Edit dialogs' *Who gets paid* (spec #1420 ticket #1465, ADR-0033 decision 9): the pencil
 * on "Payment need to paid" and on the Project / Non-Project Expenses pages. Accountant, Accountant
 * Lead and Admin set an Approved, unpaid expense's account there, as Record Payment's Change account
 * does: pick a Payee, add a new one, or (when its type doesn't require one) remove the account.
 * `editDialogPayTo` decides whether the section shows and what it offers.
 *
 * It is Change account inside the edit, not a second picker: `PayeePicker` / `usePayeeChoice` on the
 * Accounts endpoints, the type's rule worded by `changeAccountRuleLine`, and the save through
 * `useChangeExpenseAccount`. The dialog saves it with its own Save Changes, in two steps around its
 * own update: `resolve()` first (a new Payee is added now; a duplicate stops the save before anything
 * is written), then `apply()` after the update, which copies the Payee onto the expense and records
 * who and when.
 *
 * While a vendor is named in the form, the expense is paid into that vendor's account (the server
 * copies it, `services/payees/pay_to.fill_from_vendor`): the section shows it read-only and says to set
 * Vendor to "Others (No Vendor)" to pay someone else.
 */

import { useCallback, useState, type ReactNode } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { Button } from "@/components/ui/button";
import { canManagePayees } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { PAYEE_RULE, asPayeeRule } from "@/utils/payees/expensePayee";
import {
    canRemoveExpenseAccount,
    changeAccountRuleLine,
    editDialogPayTo,
    type EditDialogPayTo,
} from "@/utils/payees/paidTo";
import { sameAccountDetails } from "@/utils/payees/payeeForm";
import { pickedAccount } from "@/utils/payees/payToChoice";

import { ACCOUNTS_PAYEE_APIS, PAY_TO_BOX_API, payToBoxKey, type PayToBox } from "./paidToApi";
import { PayeePicker, PayeeReadOnly } from "./PayeePicker";
import { chosenExpensePayee, useChangeExpenseAccount } from "./useChangeExpenseAccount";
import { usePayeeChoice, type PayeeChoice } from "./usePayeeChoice";
import { useVendorAccount } from "./vendorPayeeAccount";

const OTHERS_NOTE = "To pay someone else, set Vendor to Others (No Vendor).";

interface ExpenseEditPayToArgs {
    doctype: "Project Expenses" | "Non Project Expenses";
    name: string;
    /** The stored expense's status. */
    status: string | null | undefined;
    /** The form's expense type's *Who gets paid* (Required / Optional / Not asked); undefined while
     *  the types are loading, when the stored type's rule stands. */
    rule: string | null | undefined;
    /** A vendor (not "Others (No Vendor)") is named in the form. */
    vendorNamed: boolean;
}

export interface ExpenseEditPayTo {
    offers: EditDialogPayTo;
    /** The expense's "Pay ₹X to" box: its account as stored. Undefined while loading. */
    box: PayToBox | undefined;
    boxError: boolean;
    rule: string | null | undefined;
    choice: PayeeChoice;
    /** Remove account is staged for the save. */
    removing: boolean;
    setRemoving: (removing: boolean) => void;
    canRemove: boolean;
    /** Why Save Changes can't go yet (new bank details half filled in), or null. */
    problem: string | null;
    busy: boolean;
    /** Step 1, before the dialog's update: the Payee to copy, null to remove, undefined for no change. */
    resolve: () => Promise<string | null | undefined>;
    /** Step 2, after the update: copy `payee` (from `resolve`) onto the expense. */
    apply: (payee: string | null | undefined) => Promise<void>;
    /** Start again: nothing picked, nothing staged. Call it when the dialog opens. */
    reset: () => void;
}

export function useExpenseEditPayTo({ doctype, name, status, rule: formRule, vendorNamed }: ExpenseEditPayToArgs): ExpenseEditPayTo {
    const { role, user_id } = useUserData();
    const offers = editDialogPayTo(status, canManagePayees(role, user_id), vendorNamed);
    const choice = usePayeeChoice(ACCOUNTS_PAYEE_APIS);
    const [removing, setRemoving] = useState(false);
    const { change, loading } = useChangeExpenseAccount();
    const { data, error, mutate } = useFrappeGetCall<{ message: PayToBox }>(
        PAY_TO_BOX_API,
        { doctype, name },
        offers === "none" ? null : payToBoxKey(doctype, name),
    );
    const box = data?.message;
    const rule = formRule === undefined ? box?.payee_rule : formRule;

    const changing = offers === "change";
    const canRemove = changing && canRemoveExpenseAccount(rule, !!box?.account);
    // Remove is staged only while it is offered: a type switched to Required in the form drops it.
    const remove = removing && canRemove;
    // Picking the account the expense already holds changes nothing.
    const unchanged = choice.mode === "pick" && !!box?.account && !!choice.picked
        && sameAccountDetails(pickedAccount(choice.picked), box.account);
    const pending = changing && (remove || (choice.hasChoice && !unchanged));

    const resolve = useCallback(
        async () => (pending ? chosenExpensePayee(choice, remove) : undefined),
        [pending, choice, remove],
    );
    const apply = useCallback(
        async (payee: string | null | undefined) => {
            if (payee === undefined) return;
            const next = await change(doctype, name, payee);
            await mutate({ message: next }, { revalidate: false });
        },
        [change, doctype, name, mutate],
    );
    const { reset: resetChoice } = choice;
    const reset = useCallback(() => {
        resetChoice(null);
        setRemoving(false);
    }, [resetChoice]);

    return {
        offers,
        box,
        boxError: !!error,
        rule,
        choice,
        removing: remove,
        setRemoving,
        canRemove,
        problem: changing && !remove ? choice.problem : null,
        busy: loading || choice.adding,
        resolve,
        apply,
        reset,
    };
}

interface ExpenseEditPayToSectionProps {
    payTo: ExpenseEditPayTo;
    /** The form's expense type, as the rule line names it. */
    expenseType: string;
    /** The vendor named in the form (a Project Expense), when one is. */
    vendor?: string;
    vendorName?: string | null;
    disabled?: boolean;
}

export function ExpenseEditPayToSection({ payTo, expenseType, vendor, vendorName, disabled }: ExpenseEditPayToSectionProps) {
    const { offers, box, boxError, rule, choice, removing, setRemoving, canRemove, problem, busy } = payTo;
    if (offers === "none") return null;
    const required = asPayeeRule(rule) === PAYEE_RULE.REQUIRED;
    const off = disabled || busy;

    let body: ReactNode;
    if (boxError) {
        body = <p className="text-sm text-destructive">Couldn't load who gets paid. Close and open Edit again.</p>;
    } else if (!box) {
        body = <div className="flex justify-center py-2"><TailSpin height={20} width={20} color="#71717a" /></div>;
    } else if (offers === "vendor") {
        body = <VendorAccount box={box} vendor={vendor} vendorName={vendorName} />;
    } else {
        body = (
            <>
                {box.account ? (
                    <PayeeReadOnly payee={box.account} note={removing ? "Removed when you save." : "The account now."} />
                ) : (
                    <p className="rounded-md border bg-background px-3 py-2.5 text-[13px]">No account now.</p>
                )}
                {removing ? (
                    <Button type="button" variant="outline" size="sm" className="self-start" disabled={off} onClick={() => setRemoving(false)}>
                        Keep the account
                    </Button>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground">
                            {box.account ? "To change it, pick" : "Pick"} a payee or add new bank details: its account
                            is copied onto the expense when you save.
                        </p>
                        <PayeePicker choice={choice} disabled={off} />
                        {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
                        {canRemove && (
                            <Button type="button" variant="outline" size="sm" className="self-start" disabled={off} onClick={() => setRemoving(true)}>
                                Remove account
                            </Button>
                        )}
                    </>
                )}
            </>
        );
    }

    return (
        <section aria-labelledby="edit-who-gets-paid" className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5">
            <div>
                <h3 id="edit-who-gets-paid" className="text-sm font-semibold">
                    Who gets paid{required && <span className="text-destructive">*</span>}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                    {/* A vendor's account is never removed here, so the line doesn't offer it. */}
                    {changeAccountRuleLine(rule, expenseType, offers === "change" && !!box?.account)}
                </p>
            </div>
            {body}
        </section>
    );
}

/** The vendor's account, read-only: the expense's own copy while the form keeps its stored vendor,
 *  else the newly named vendor's account, which the save copies. */
function VendorAccount({ box, vendor, vendorName }: { box: PayToBox; vendor?: string; vendorName?: string | null }) {
    const keepsVendor = !!vendor && vendor === box.vendor;
    const { account, isLoading } = useVendorAccount(vendor, !keepsVendor);
    if (!keepsVendor && isLoading) {
        return <div className="flex justify-center py-2"><TailSpin height={20} width={20} color="#71717a" /></div>;
    }
    const payTo = keepsVendor ? box.account : account?.payee ?? null;
    const who = vendorName || (keepsVendor ? box.vendor_name : account?.vendor_name) || "This vendor";
    return payTo ? (
        <PayeeReadOnly payee={payTo} note={`This is the vendor's account. ${OTHERS_NOTE}`} />
    ) : (
        <p className="rounded-md border bg-background px-3 py-2.5 text-[13px]">
            {who} has no bank account on record. {OTHERS_NOTE}
        </p>
    );
}
