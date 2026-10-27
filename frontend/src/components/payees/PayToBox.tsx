/**
 * Record Payment's "Pay ₹X to" box (spec #1420 tickets #1431, #1438, approved mockup screen 12): the
 * row's own pay-to account, with Copy beside the account number and IFSC, its bank, who set it, and,
 * on an expense, Change account.
 *
 * Shown for an expense and for a PO / WO payment. Who to pay is the server's
 * (`services/payees/paid_to.pay_to_box`); what the box says about it is `utils/payees/paidTo.payToBoxView`;
 * when Change account shows is the server's edit answer (`canChangeExpenseAccount`): an expense whose
 * account the viewer may change (Accounts, until it is paid), not yet paid, no vendor named. A PO / WO
 * payment's copy is never edited by hand.
 *
 * An unpaid PO / WO payment whose vendor's account changed since it was raised, or that has none
 * (#1463), turns blue: the account shown, with its Copy buttons, is the vendor's current one, which
 * it is paid into, and the one it was raised with is named under it as "Was", with no Copy buttons,
 * so nobody pastes it into the bank portal. Exporting the payment or marking it paid writes the
 * vendor's account onto it, so a paid payment shows that account plainly.
 */

import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useExpenseFieldAccess } from "@/hooks/useExpenseDecision";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { bankLine } from "@/utils/payees/payeeForm";
import {
    VENDOR_ACCOUNT_TITLE,
    canChangeExpenseAccount,
    namedByText,
    payToBoxView,
    type PayToBoxDoctype,
    type PayToBoxView,
} from "@/utils/payees/paidTo";

import { ChangeExpenseAccountDialog } from "./ChangeExpenseAccountDialog";
import { ACCOUNTS_PAYEE_APIS, PAY_TO_BOX_API, payToBoxKey, type PayToBox as PayToBoxData } from "./paidToApi";
import { usePayeeChoice } from "./usePayeeChoice";

const TONE_CLASSES: Record<PayToBoxView["tone"], { box: string; heading: string }> = {
    vendor_account: { box: "border-blue-500 bg-blue-50 dark:bg-blue-950/30", heading: "text-blue-800 dark:text-blue-300" },
    account: { box: "border-green-600 bg-green-50 dark:bg-green-950/30", heading: "text-green-800 dark:text-green-300" },
    no_account: { box: "border-amber-400 bg-amber-50 dark:bg-amber-950/30", heading: "text-amber-900 dark:text-amber-300" },
};

interface PayToBoxProps {
    doctype: PayToBoxDoctype;
    name: string;
    /** An expense's type, for the no-account wording. */
    expenseType?: string;
}

export function PayToBox({ doctype, name, expenseType = "" }: PayToBoxProps) {
    const editAccess = useExpenseFieldAccess();
    const [changing, setChanging] = useState(false);
    const changeChoice = usePayeeChoice(ACCOUNTS_PAYEE_APIS);
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: PayToBoxData }>(
        PAY_TO_BOX_API,
        { doctype, name },
        payToBoxKey(doctype, name),
    );
    const box = data?.message;

    if (isLoading) {
        return <div className="h-28 animate-pulse rounded-lg border-2 border-green-200 bg-green-50/60" />;
    }
    if (error || !box) {
        return (
            <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                Couldn't load who to pay. Close and open Record Payment again.
            </p>
        );
    }

    // A switching payment is paid into its vendor's current account; the one it holds is only "Was".
    const account = box.switch_to ?? box.account;
    const was = box.switch_to ? box.account : null;
    const canChange = canChangeExpenseAccount(doctype, box, editAccess);
    const view = payToBoxView(doctype, box, expenseType, canChange);
    const switching = view.tone === "vendor_account";
    const bank = account ? bankLine(account) : "";
    // Each open starts from a fresh pick: the copy is not a Payee, so there is nothing to seed it with.
    const openChange = () => {
        changeChoice.reset(null);
        setChanging(true);
    };

    return (
        <section
            aria-labelledby="pay-to-heading"
            className={cn("flex flex-col gap-3 rounded-lg border-2 p-4", TONE_CLASSES[view.tone].box)}
        >
            <div className="flex items-baseline gap-2">
                <h3
                    id="pay-to-heading"
                    className={cn("flex-grow text-sm font-semibold", TONE_CLASSES[view.tone].heading)}
                >
                    Pay {formatToRoundedIndianRupee(box.amount)} to
                </h3>
                {canChange && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={openChange}>
                        Change account
                    </Button>
                )}
            </div>

            {switching && (
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">{VENDOR_ACCOUNT_TITLE}</p>
            )}

            {account ? (
                <>
                    <p className="text-xl font-bold leading-tight">{account.account_name}</p>
                    {/* The account number and IFSC each get a full row, so neither wraps mid-value beside its Copy button. */}
                    <CopyValue label="Account number" value={account.account_number} />
                    <CopyValue label="IFSC" value={account.ifsc} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Fact label="Bank" value={bank || "--"} />
                        {switching ? (
                            <Fact
                                label="Was"
                                value={was ? `${was.account_name}, A/c ${was.account_number}, ${was.ifsc}` : "No account"}
                            />
                        ) : (
                            <Fact label="Set by" value={namedByText(box.named_by, box.vendor_name)} />
                        )}
                    </div>
                </>
            ) : (
                view.noAccount && (
                    <p className="text-sm">
                        <span className="font-semibold">{view.noAccount.title}</span> {view.noAccount.detail}
                    </p>
                )
            )}

            {view.note && <p className="text-xs text-muted-foreground">{view.note}</p>}

            {canChange && (
                <ChangeExpenseAccountDialog
                    open={changing}
                    onOpenChange={setChanging}
                    doctype={doctype}
                    box={box}
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

/** A value to paste into the bank portal, on one line, with a Copy button that copies exactly it. */
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
                <p className="mt-0.5 whitespace-nowrap text-[15px] font-semibold tabular-nums tracking-wide">{value}</p>
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
