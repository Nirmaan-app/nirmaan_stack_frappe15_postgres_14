/**
 * Record Payment's "Pay ₹X to" box (spec #1420 ticket #1431, approved mockup screen 12): the
 * expense's Payee, with Copy beside the account number and IFSC, its bank, who named it, and
 * Change payee.
 *
 * Who to pay is the server's (`services/payees/paid_to.expense_pay_to`). Change payee shows for
 * Accounts only, and not on a Project Expense with a vendor: that one is paid into the vendor's Payee.
 */

import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { canManagePayees } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { bankLine } from "@/utils/payees/payeeForm";
import { namedByText, noPayeeBoxText } from "@/utils/payees/paidTo";

import { ChangeExpensePayeeDialog } from "./ChangeExpensePayeeDialog";
import { ACCOUNTS_PAYEE_APIS, EXPENSE_PAYEE_API, expensePayToKey, type ExpensePayTo } from "./expensePayeeApi";
import { usePayeeChoice } from "./usePayeeChoice";

interface ExpensePayToBoxProps {
    doctype: "Project Expenses" | "Non Project Expenses";
    expenseName: string;
    expenseType: string;
}

export function ExpensePayToBox({ doctype, expenseName, expenseType }: ExpensePayToBoxProps) {
    const { role, user_id } = useUserData();
    const [changing, setChanging] = useState(false);
    const changeChoice = usePayeeChoice(ACCOUNTS_PAYEE_APIS);
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: ExpensePayTo }>(
        EXPENSE_PAYEE_API,
        { doctype, name: expenseName },
        expensePayToKey(doctype, expenseName),
    );
    const payTo = data?.message;

    if (isLoading) {
        return <div className="h-28 animate-pulse rounded-lg border-2 border-green-200 bg-green-50/60" />;
    }
    if (error || !payTo) {
        return (
            <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                Couldn't load who to pay. Close and open Record Payment again.
            </p>
        );
    }

    const payee = payTo.payee;
    const canChange = canManagePayees(role, user_id) && !payTo.vendor_fixed && !payTo.paid;
    const bank = payee ? bankLine(payee) : "";
    // Each open starts from the expense's own Payee.
    const openChange = () => {
        changeChoice.reset(payee);
        setChanging(true);
    };

    return (
        <section
            aria-labelledby="pay-to-heading"
            className={cn(
                "flex flex-col gap-3 rounded-lg border-2 p-4",
                payee
                    ? "border-green-600 bg-green-50 dark:bg-green-950/30"
                    : "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
            )}
        >
            <div className="flex items-baseline gap-2">
                <h3
                    id="pay-to-heading"
                    className={cn("flex-grow text-sm font-semibold", payee ? "text-green-800 dark:text-green-300" : "text-amber-900 dark:text-amber-300")}
                >
                    Pay {formatToRoundedIndianRupee(payTo.amount)} to
                </h3>
                {canChange && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={openChange}>
                        Change payee
                    </Button>
                )}
            </div>

            {payee ? (
                <>
                    <p className="text-xl font-bold leading-tight">{payee.account_name}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <CopyValue label="Account number" value={payee.account_number} />
                        <CopyValue label="IFSC" value={payee.ifsc} />
                        <Fact label="Bank" value={bank || "--"} />
                        <Fact label="Named by" value={namedByText(payTo.named_by, payTo.vendor_name)} />
                    </div>
                </>
            ) : payTo.vendor_fixed ? (
                <p className="text-sm">
                    <span className="font-semibold">No payee.</span>{" "}
                    {payTo.vendor_name || "The vendor"} has no bank account on record. Add one on the vendor page
                    before paying.
                </p>
            ) : (
                <p className="text-sm">
                    <span className="font-semibold">No payee.</span> {noPayeeBoxText(payTo.payee_rule, expenseType)}
                </p>
            )}

            {payTo.vendor_fixed && payee && (
                <p className="text-xs text-muted-foreground">
                    This is {payTo.vendor_name || "the vendor"}'s account. To change it, change the vendor's account on
                    the vendor page.
                </p>
            )}

            {canChange && (
                <ChangeExpensePayeeDialog
                    open={changing}
                    onOpenChange={setChanging}
                    doctype={doctype}
                    payTo={payTo}
                    expenseType={expenseType}
                    choice={changeChoice}
                    onSaved={(next) => mutate({ message: next }, { revalidate: false })}
                />
            )}
        </section>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm font-medium">{value}</p>
        </div>
    );
}

/** A value to paste into the bank portal, with a Copy button that copies exactly it. */
function CopyValue({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (await copyTextToClipboard(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } else {
            toast({ title: "Couldn't copy", description: `Select and copy ${value} by hand.`, variant: "destructive" });
        }
    };
    return (
        <div className="flex items-end gap-2">
            <div className="min-w-0 flex-grow">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-0.5 break-all text-[15px] font-semibold tabular-nums tracking-wide">{value}</p>
            </div>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                aria-label={`Copy ${label.toLowerCase()}`}
                onClick={copy}
            >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
            </Button>
        </div>
    );
}
