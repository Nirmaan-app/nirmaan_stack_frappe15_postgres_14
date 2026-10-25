/**
 * Change account (spec #1420 tickets #1431, #1438): overwrite an expense's own pay-to account with
 * another Payee's account, new bank details, or (when its type doesn't require one) none, before
 * paying it. It names the expense by its description (`expenseTitle`), never its ID, and words its
 * type's *Who gets paid* (`changeAccountRuleLine`): a Required type is never offered Remove account.
 * The expense keeps a copy, never a link: editing the Payee later changes nothing here.
 *
 * Reuses the request's `PayeePicker` / `usePayeeChoice`, on the Accounts endpoints
 * (`ACCOUNTS_PAYEE_APIS`), and saves through `useChangeExpenseAccount`, as the expense Edit dialogs'
 * Who gets paid does (#1465). The opener holds the choice and resets it in the handler that opens this
 * dialog. Which expenses may change is the server's edit answer (`canChangeExpenseAccount`: Accounts,
 * until the expense is paid); the save records who changed it and when.
 */

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
import { canRemoveExpenseAccount, changeAccountRuleLine, expenseTitle, expenseTypeAside } from "@/utils/payees/paidTo";
import { sameAccountDetails } from "@/utils/payees/payeeForm";
import { pickedAccount } from "@/utils/payees/payToChoice";

import type { PayToBox } from "./paidToApi";
import { PayeePicker } from "./PayeePicker";
import { chosenExpensePayee, expenseAccountSaveError, useChangeExpenseAccount } from "./useChangeExpenseAccount";
import type { PayeeChoice } from "./usePayeeChoice";

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
    const { change, loading } = useChangeExpenseAccount();

    const title = expenseTitle(box.description, expenseType);
    const canRemove = canRemoveExpenseAccount(box.payee_rule, !!box.account);
    const busy = loading || choice.adding;

    const save = async (clear: boolean) => {
        try {
            const payee = await chosenExpensePayee(choice, clear);
            if (payee === undefined) return;
            const next = await change(doctype, box.name, payee);
            toast({
                title: "Account changed",
                description: next.account
                    ? `${title} is now paid to ${next.account.account_name}.`
                    : `${title} has no account now.`,
                variant: "success",
            });
            onSaved(next);
            onOpenChange(false);
        } catch (e) {
            toast({ title: "Could not change the account", description: expenseAccountSaveError(e), variant: "destructive" });
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
                        {expenseTypeAside(title, expenseType)} is paid into. Pick a payee or
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
