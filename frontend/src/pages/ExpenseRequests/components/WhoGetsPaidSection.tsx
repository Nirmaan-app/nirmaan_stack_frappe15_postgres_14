// The request's "Who gets paid" section (spec #1420 tickets #1429, #1436, approved mockup screen 10).
//
// Shown when the expense type asks (Required or Optional), or a vendor is picked on a Not asked type
// (`showsWhoGetsPaid`: the request still copies the vendor's account). Three states:
//   * a vendor is picked  -> the account the request is paid into, read-only (the vendor's Payee,
//                            or the request's own copy while an edit keeps the vendor), or a note
//                            that the vendor has none;
//   * no vendor, pick     -> search existing Payees;
//   * no vendor, add new  -> the Add Payee fields, inline.
// Whichever is chosen, its full account (holder, account number, IFSC, bank, branch) shows before
// sending. The server copies it into the request's pay-to account (`services/payees/pay_to`); the
// blocking note is a screen rule (`utils/payees/expensePayee.whoGetsPaidProblem`).

import React from "react";
import { TailSpin } from "react-loader-spinner";

import { PayeePicker, PayeeReadOnly } from "@/components/payees/PayeePicker";
import type { PayeeChoice } from "@/components/payees/usePayeeChoice";
import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { PAYEE_RULE, asPayeeRule, whoGetsPaidHelp } from "@/utils/payees/expensePayee";

interface Props {
    rule: string;
    expenseType: string;
    /** Set while a vendor (not "Others (No Vendor)") is picked. */
    vendorChosen: boolean;
    /** The picked vendor's display name. */
    vendorName: string | null;
    /** The account the request is paid into while a vendor is picked; null when the vendor has none. */
    vendorPayTo: PayToAccount | null;
    vendorPayToLoading: boolean;
    choice: PayeeChoice;
    /** Why the request can't be sent yet because of who gets paid, shown under the section. */
    problem: string | null;
    disabled?: boolean;
}

export const WhoGetsPaidSection: React.FC<Props> = ({
    rule, expenseType, vendorChosen, vendorName, vendorPayTo, vendorPayToLoading, choice, problem, disabled,
}) => {
    const required = asPayeeRule(rule) === PAYEE_RULE.REQUIRED;
    // What still blocks sending, under the picker. The IFSC lookup and the duplicate block already
    // speak for themselves inside the fields, so they are not repeated here.
    const { duplicate, lookingUp } = choice.bankForm;
    const note = choice.mode === "new"
        ? (duplicate || lookingUp ? null : choice.problem)
        : problem;
    return (
        <section
            aria-labelledby="who-gets-paid"
            className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5"
        >
            <div>
                <h3 id="who-gets-paid" className="text-sm font-semibold">
                    Who gets paid{required && <span className="text-destructive">*</span>}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{whoGetsPaidHelp(rule, expenseType)}</p>
            </div>

            {vendorChosen ? (
                vendorPayToLoading ? (
                    <div className="flex justify-center py-2"><TailSpin height={20} width={20} color="#71717a" /></div>
                ) : vendorPayTo ? (
                    <>
                        <PayeeReadOnly
                            payee={vendorPayTo}
                            note={"This is the vendor's account. To pay someone else, set Vendor to Others (No Vendor)."}
                        />
                        {problem && <p className="text-xs text-destructive">{problem}</p>}
                    </>
                ) : (
                    <p className="rounded-md border bg-background px-3 py-2.5 text-[13px]">
                        {problem ?? `${vendorName || "This vendor"} has no bank account on record yet. ` +
                            "To pay someone else, set Vendor to Others (No Vendor)."}
                    </p>
                )
            ) : (
                <>
                    <PayeePicker choice={choice} disabled={disabled} />
                    {note && <p className="text-xs text-muted-foreground">{note}</p>}
                </>
            )}
        </section>
    );
};

export default WhoGetsPaidSection;
