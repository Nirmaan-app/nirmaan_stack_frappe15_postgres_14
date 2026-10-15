/**
 * Change account (spec #1420 tickets #1431, #1438): overwrite an expense's own pay-to account with
 * another Payee's account, new bank details, or (when its type doesn't require one) none, before
 * paying it. It names the expense by its description (`expenseTitle`), never its ID, and words its
 * type's *Who gets paid* (`changeAccountRuleLine`): a Required type is never offered Remove account.
 * The expense keeps a copy, never a link: editing the Payee later changes nothing here.
 *
 * Reuses the request's `PayeePicker` / `usePayeeChoice`, on the Accounts endpoints
 * (`ACCOUNTS_PAYEE_APIS`): Change account is Admin, Accountant and Accountant Lead only. The opener
 * holds the choice and resets it in the handler that opens this dialog. Which expenses may change is
 * a screen rule (`canChangeExpenseAccount`); the save records who changed it and when.
 */

import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { canRemoveExpenseAccount, changeAccountRuleLine, expenseTitle } from "@/utils/payees/paidTo";
import { sameAccountDetails } from "@/utils/payees/payeeForm";
import { pickedAccount } from "@/utils/payees/payToChoice";

import { CHANGE_EXPENSE_ACCOUNT_API, type PayToBox } from "./paidToApi";
import { PayeePicker } from "./PayeePicker";
import { DuplicatePayeeError, type PayeeChoice } from "./usePayeeChoice";

interface ChangeExpenseAccountDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    doctype: string;
    box: PayToBox;
    expenseType: string;
    /** `usePayeeChoice(ACCOUNTS_PAYEE_APIS)`, reset by whoever opens the dialog. */
    choice: PayeeChoice;
    onSaved: (box: PayToBox) => void;
}

export function ChangeExpenseAccountDialog({
    open, onOpenChange, doctype, box, expenseType, choice, onSaved,
}: ChangeExpenseAccountDialogProps) {
    const { call, loading } = useFrappePostCall<{ message: PayToBox }>(CHANGE_EXPENSE_ACCOUNT_API);

    const title = expenseTitle(box.description, expenseType);
    const canRemove = canRemoveExpenseAccount(box.payee_rule, !!box.account);
    const busy = loading || choice.adding;

    const save = async (clear: boolean) => {
        try {
            const picked = clear ? null : await choice.resolve();
            // Only a Payee is copied: this dialog never seeds the expense's own account as the pick.
            if (!clear && picked?.kind !== "payee") return;
            const res = await call({ doctype, name: box.name, payee: picked?.kind === "payee" ? picked.payee.name : null });
            toast({
                title: "Account changed",
                description: res.message.account
                    ? `${title} is now paid to ${res.message.account.account_name}.`
                    : `${title} has no account now.`,
                variant: "success",
            });
            onSaved(res.message);
            onOpenChange(false);
        } catch (e) {
            const description = e instanceof DuplicatePayeeError ? e.message : getFrappeError(e);
            toast({ title: "Could not change the account", description, variant: "destructive" });
        }
    };

    // Picking the account the expense already holds changes nothing.
    const unchanged = choice.mode === "pick" && !!box.account && !!choice.picked
        && sameAccountDetails(pickedAccount(choice.picked), box.account);

    return (
        <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>Change account</AlertDialogTitle>
                    <AlertDialogDescription>
                        The account <span className="font-medium text-foreground">{title}</span>
                        {expenseType && title !== expenseType ? ` (${expenseType})` : ""} is paid into. Pick a payee or
                        add new bank details: its account is copied onto the expense.{" "}
                        {changeAccountRuleLine(box.payee_rule, expenseType, !!box.account)}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="max-h-[60vh] overflow-y-auto pr-1">
                    <PayeePicker choice={choice} disabled={busy} />
                    {choice.problem && <p className="mt-2 text-xs text-muted-foreground">{choice.problem}</p>}
                </div>

                <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    {canRemove && (
                        <Button variant="outline" disabled={busy} onClick={() => save(true)}>
                            Remove account
                        </Button>
                    )}
                    <Button disabled={busy || !choice.hasChoice || unchanged} onClick={() => save(false)}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save account
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
