/**
 * Change payee (spec #1420 ticket #1431): point an expense at another Payee, new bank details, or
 * (when its type doesn't require one) none, before paying it.
 *
 * Reuses the request's `PayeePicker` / `usePayeeChoice`, on the Accounts endpoints
 * (`ACCOUNTS_PAYEE_APIS`): Change payee is Admin, Accountant and Accountant Lead only. The opener holds
 * the choice and resets it to the expense's own Payee in the handler that opens this dialog. Ticket 9's rules are the server's
 * (`services/payees/expense_payee.change_expense_payee`): a Required type can't be left without one,
 * an Inactive Payee can't be newly picked, a Paid expense keeps its Payee.
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
import { PAYEE_RULE, asPayeeRule } from "@/utils/payees/expensePayee";

import { CHANGE_EXPENSE_PAYEE_API, type ExpensePayTo } from "./expensePayeeApi";
import { PayeePicker } from "./PayeePicker";
import { DuplicatePayeeError, type PayeeChoice } from "./usePayeeChoice";

interface ChangeExpensePayeeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    doctype: string;
    payTo: ExpensePayTo;
    expenseType: string;
    /** `usePayeeChoice(ACCOUNTS_PAYEE_APIS)`, reset to `payTo.payee` by whoever opens the dialog. */
    choice: PayeeChoice;
    onSaved: (payTo: ExpensePayTo) => void;
}

export function ChangeExpensePayeeDialog({
    open, onOpenChange, doctype, payTo, expenseType, choice, onSaved,
}: ChangeExpensePayeeDialogProps) {
    const { call, loading } = useFrappePostCall<{ message: ExpensePayTo }>(CHANGE_EXPENSE_PAYEE_API);

    const required = asPayeeRule(payTo.payee_rule) === PAYEE_RULE.REQUIRED;
    const busy = loading || choice.adding;

    const save = async (clear: boolean) => {
        try {
            const payee = clear ? null : await choice.resolve();
            if (!clear && !payee) return;
            const res = await call({ doctype, name: payTo.name, payee: payee?.name ?? null });
            toast({
                title: "Payee changed",
                description: res.message.payee
                    ? `${payTo.name} is now paid to ${res.message.payee.account_name}.`
                    : `${payTo.name} has no payee now.`,
                variant: "success",
            });
            onSaved(res.message);
            onOpenChange(false);
        } catch (e) {
            const description = e instanceof DuplicatePayeeError ? e.message : getFrappeError(e);
            toast({ title: "Could not change the payee", description, variant: "destructive" });
        }
    };

    const unchanged = choice.mode === "pick" && choice.picked?.name === payTo.payee?.name;

    return (
        <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>Change payee</AlertDialogTitle>
                    <AlertDialogDescription>
                        Who {payTo.name} is paid to. {required
                            ? `${expenseType || "Its type"} requires a payee.`
                            : `${expenseType || "Its type"} doesn't require one.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="max-h-[60vh] overflow-y-auto pr-1">
                    <PayeePicker choice={choice} disabled={busy} />
                    {choice.problem && <p className="mt-2 text-xs text-muted-foreground">{choice.problem}</p>}
                </div>

                <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    {!required && payTo.payee && (
                        <Button variant="outline" disabled={busy} onClick={() => save(true)}>
                            Remove payee
                        </Button>
                    )}
                    <Button disabled={busy || !choice.hasChoice || unchanged} onClick={() => save(false)}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save payee
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
